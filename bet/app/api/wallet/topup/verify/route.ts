import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { verifyPaymentSignature } from "@/lib/razorpay";
import { publish, Channels } from "@/lib/pubsub";
import { logger } from "@/lib/logger";

const Body = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

/**
 * Client-side verify hop after Razorpay Checkout succeeds. Validates the
 * HMAC signature, marks the PaymentOrder CAPTURED, credits the wallet —
 * all atomically inside a Prisma transaction.
 *
 * Idempotent via the unique `(kind, reference)` index on Transaction —
 * the reference is `razorpay:<paymentId>`, so the webhook hitting `/api
 * /webhooks/razorpay` later sees the duplicate and short-circuits.
 *
 * If the client never makes it here (browser closed mid-checkout, e.g.)
 * the webhook is the safety net.
 */
export async function POST(req: Request) {
  const u = await getAuthedUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
    parsed.data;

  if (!verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    logger.warn("razorpay verify: signature mismatch", {
      userId: u.id,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
    });
    return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const order = await tx.paymentOrder.findUnique({
        where: { razorpayOrderId: razorpay_order_id },
      });
      if (!order) {
        return { ok: false as const, error: "order_not_found", status: 404 };
      }
      if (order.userId !== u.id) {
        return { ok: false as const, error: "forbidden", status: 403 };
      }
      if (order.status === "CAPTURED") {
        // Already credited — return the current balance.
        const wallet = await tx.wallet.findUnique({
          where: { userId: u.id },
          select: { balance: true },
        });
        return {
          ok: true as const,
          duplicate: true,
          credited: 0,
          balance: wallet?.balance ?? 0,
        };
      }

      // Idempotency on the Transaction side — if a webhook beat us here,
      // the wallet was already updated and this insert will throw P2002.
      const reference = `razorpay:${razorpay_payment_id}`;
      try {
        await tx.transaction.create({
          data: {
            userId: u.id,
            delta: order.coins,
            kind: "wallet_topup",
            reference,
            metadata: {
              razorpayOrderId: order.razorpayOrderId,
              razorpayPaymentId: razorpay_payment_id,
              amountInr: order.amountInr,
              packId: order.packId,
            },
          },
        });
      } catch (e) {
        if ((e as { code?: string })?.code === "P2002") {
          await tx.paymentOrder.update({
            where: { id: order.id },
            data: {
              razorpayPaymentId: razorpay_payment_id,
              status: "CAPTURED",
              capturedAt: new Date(),
            },
          });
          const wallet = await tx.wallet.findUnique({
            where: { userId: u.id },
            select: { balance: true },
          });
          return {
            ok: true as const,
            duplicate: true,
            credited: 0,
            balance: wallet?.balance ?? 0,
          };
        }
        throw e;
      }

      const wallet = await tx.wallet.update({
        where: { userId: u.id },
        data: { balance: { increment: order.coins } },
      });
      await tx.paymentOrder.update({
        where: { id: order.id },
        data: {
          razorpayPaymentId: razorpay_payment_id,
          status: "CAPTURED",
          capturedAt: new Date(),
        },
      });
      await tx.notification.create({
        data: {
          userId: u.id,
          title: "Wallet topped up",
          body: `+${order.coins.toLocaleString()} coins (₹${order.amountInr}). Ready to spend across markets, auctions and Aviator.`,
          href: "/wallet",
        },
      });

      return {
        ok: true as const,
        duplicate: false,
        credited: order.coins,
        balance: wallet.balance,
      };
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    publish(Channels.user(u.id), { type: "wallet", at: Date.now() });
    return NextResponse.json({
      ok: true,
      duplicate: result.duplicate,
      credited: result.credited,
      balance: result.balance,
    });
  } catch (e) {
    logger.error(e, {
      route: "/api/wallet/topup/verify",
      userId: u.id,
      orderId: razorpay_order_id,
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
