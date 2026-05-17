import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyWebhookSignature } from "@/lib/razorpay";
import { publish, Channels } from "@/lib/pubsub";
import { logger } from "@/lib/logger";

// Razorpay needs to receive raw JSON in the order it sent — no Next.js
// auto-parsing. The HMAC is over the EXACT bytes.
export const dynamic = "force-dynamic";

/**
 * Razorpay webhook receiver. The signature is over the raw request body
 * with `RAZORPAY_WEBHOOK_SECRET`. We handle `payment.captured` (the only
 * one that mutates wallet state) and ack everything else 200 so Razorpay
 * doesn't retry irrelevant events forever.
 *
 * Defense-in-depth: the user-side /verify route also credits. The verify
 * uses `kind="wallet_topup"`, `reference="razorpay:<paymentId>"`. The
 * webhook uses the same reference, so a P2002 from the unique index is
 * the "already credited" signal — we still flip PaymentOrder.status to
 * CAPTURED and return 200.
 */
export async function POST(req: Request) {
  const signature = req.headers.get("x-razorpay-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }
  const rawBody = await req.text();

  if (!verifyWebhookSignature(rawBody, signature)) {
    logger.warn("razorpay webhook: bad signature", {
      preview: rawBody.slice(0, 120),
    });
    return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  }

  let event: { event: string; payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number; status?: string } } } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  // Only the captured event mutates wallet balances. Authorised + failed
  // events get acknowledged but ignored — keeps the route compatible with
  // adding more handlers later without a fresh deploy.
  if (event.event !== "payment.captured") {
    return NextResponse.json({ ok: true, ignored: event.event });
  }

  const payment = event.payload?.payment?.entity;
  if (!payment?.id || !payment.order_id) {
    return NextResponse.json({ error: "malformed_payload" }, { status: 400 });
  }
  const paymentId = payment.id;
  const orderId = payment.order_id;

  try {
    const result = await db.$transaction(async (tx) => {
      const order = await tx.paymentOrder.findUnique({
        where: { razorpayOrderId: orderId },
      });
      if (!order) {
        // Webhook for an order we don't know about — could be a different
        // app sharing the same Razorpay account, or a stale dev order.
        return { credited: 0, missingOrder: true };
      }
      if (order.status === "CAPTURED") {
        return { credited: 0, alreadyCaptured: true };
      }
      const reference = `razorpay:${paymentId}`;
      try {
        await tx.transaction.create({
          data: {
            userId: order.userId,
            delta: order.coins,
            kind: "wallet_topup",
            reference,
            metadata: {
              razorpayOrderId: order.razorpayOrderId,
              razorpayPaymentId: paymentId,
              source: "webhook",
              packId: order.packId,
              amountInr: order.amountInr,
            },
          },
        });
      } catch (e) {
        if ((e as { code?: string })?.code === "P2002") {
          // Verify route beat us — flip status, return.
          await tx.paymentOrder.update({
            where: { id: order.id },
            data: {
              razorpayPaymentId: paymentId,
              status: "CAPTURED",
              capturedAt: new Date(),
            },
          });
          return { credited: 0, raceLost: true, userId: order.userId };
        }
        throw e;
      }
      await tx.wallet.update({
        where: { userId: order.userId },
        data: { balance: { increment: order.coins } },
      });
      await tx.paymentOrder.update({
        where: { id: order.id },
        data: {
          razorpayPaymentId: paymentId,
          status: "CAPTURED",
          capturedAt: new Date(),
        },
      });
      await tx.notification.create({
        data: {
          userId: order.userId,
          title: "Wallet topped up",
          body: `+${order.coins.toLocaleString()} coins (₹${order.amountInr}).`,
          href: "/wallet",
        },
      });
      return { credited: order.coins, userId: order.userId };
    });

    if ("userId" in result && result.userId) {
      publish(Channels.user(result.userId), { type: "wallet", at: Date.now() });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    logger.error(e, {
      route: "/api/webhooks/razorpay",
      paymentId,
      orderId,
    });
    // 500 → Razorpay will retry. That's intentional — a transient DB blip
    // shouldn't lose a payment.
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
