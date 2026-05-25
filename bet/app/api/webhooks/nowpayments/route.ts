import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  isFullyConfigured,
  normaliseStatus,
  verifyIpnSignature,
  isCreditable,
  type NowPaymentStatus,
} from "@/lib/nowpayments";
import { logger } from "@/lib/logger";

/**
 * POST /api/webhooks/nowpayments  (PR-BET-NOWPAYMENTS)
 *
 * NOWPayments IPN callback. Fires on every payment_status transition
 * for invoices that were created with `ipn_callback_url` pointing
 * here. We:
 *
 *   1. Read the raw body BEFORE parsing (signature is over the
 *      exact bytes NOWPayments POSTed — re-stringifying after JSON
 *      parse may reorder keys and break verification).
 *   2. Verify the `x-nowpayments-sig` HMAC-SHA512 header against
 *      IPN_SECRET. If unverified, return 401 without crediting.
 *   3. Look up our CryptoPaymentOrder by `order_id` (the local row
 *      id we threaded into the invoice). If unknown, ignore — could
 *      be a stale invoice from a previous deploy.
 *   4. Update the order row's status + cached fields.
 *   5. If the status is FINISHED and the order isn't already
 *      captured, atomically credit the user's wallet + write a
 *      Transaction(kind='deposit'). The `(kind, reference)`
 *      uniqueness on Transaction makes the credit idempotent —
 *      duplicate IPN deliveries are harmless.
 *   6. Always return 200 to NOWPayments (except on auth failure /
 *      malformed body) so they don't retry indefinitely.
 */
export const runtime = "nodejs";

interface IpnPayload {
  payment_id?: string | number;
  payment_status?: NowPaymentStatus;
  order_id?: string;
  order_description?: string | null;
  pay_address?: string;
  pay_amount?: number | string;
  pay_currency?: string;
  actually_paid?: number | string;
  price_amount?: number;
  price_currency?: string;
  outcome_amount?: number;
  outcome_currency?: string;
  purchase_id?: string;
  created_at?: string;
  updated_at?: string;
  // unknown fields preserved via [k: string]: unknown
  [k: string]: unknown;
}

export async function POST(req: Request) {
  if (!isFullyConfigured()) {
    // Don't credit if we can't verify. Returning 503 (not 200) so
    // NOWPayments retries once we configure the secret.
    logger.warn(
      "IPN received but NOWPAYMENTS_IPN_SECRET / NOWPAYMENTS_API_KEY missing",
      { route: "/api/webhooks/nowpayments" },
    );
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  // CRITICAL: signature is over the RAW bytes. Don't JSON.parse +
  // re-stringify before verification.
  const rawBody = await req.text();
  const sigHeader = req.headers.get("x-nowpayments-sig");
  if (!verifyIpnSignature(rawBody, sigHeader)) {
    logger.warn("IPN signature verification failed", {
      route: "/api/webhooks/nowpayments",
    });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: IpnPayload;
  try {
    payload = JSON.parse(rawBody) as IpnPayload;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const orderRef = payload.order_id;
  if (!orderRef) {
    return NextResponse.json({ ok: true, note: "no_order_id" });
  }
  const order = await db.cryptoPaymentOrder.findUnique({
    where: { id: orderRef },
  });
  if (!order) {
    // Unknown order — could be a leftover from a previous deploy.
    // 200 so NOWPayments stops retrying.
    return NextResponse.json({ ok: true, note: "unknown_order" });
  }

  const newStatus = payload.payment_status
    ? normaliseStatus(payload.payment_status)
    : order.status;

  // Update bookkeeping fields. Always non-destructive — we only fill
  // in nulls; existing values stay (a later IPN may carry less
  // detail than the first).
  await db.cryptoPaymentOrder.update({
    where: { id: order.id },
    data: {
      status: newStatus,
      paymentId:
        order.paymentId ??
        (payload.payment_id != null ? String(payload.payment_id) : null),
      payCurrency: order.payCurrency ?? payload.pay_currency ?? null,
      payAmount:
        order.payAmount ??
        (payload.pay_amount != null ? String(payload.pay_amount) : null),
      payAddress: order.payAddress ?? payload.pay_address ?? null,
      rawWebhook: payload as never,
    },
  });

  // Terminal-success branch: credit the wallet exactly once.
  if (isCreditable(newStatus) && !order.capturedAt) {
    const paymentId = payload.payment_id ? String(payload.payment_id) : order.id;
    // The reference is the dedup key on Transaction. Repeated IPNs
    // with the same payment_id will hit the unique index + skip.
    const reference = `nowpayments:${paymentId}`;
    try {
      await db.$transaction(async (tx) => {
        // Defence: re-read inside the txn in case two IPNs raced.
        const fresh = await tx.cryptoPaymentOrder.findUnique({
          where: { id: order.id },
          select: { capturedAt: true },
        });
        if (fresh?.capturedAt) return; // someone else already credited

        // Wallet upsert — create if missing (defensive; signup
        // should always create one).
        await tx.wallet.upsert({
          where: { userId: order.userId },
          create: { userId: order.userId, balance: order.coins },
          update: { balance: { increment: order.coins } },
        });
        await tx.transaction.create({
          data: {
            userId: order.userId,
            delta: order.coins,
            kind: "deposit",
            reference,
            metadata: {
              provider: "nowpayments",
              paymentId,
              invoiceId: order.invoiceId,
              packId: order.packId,
              priceInr: order.amountInr,
              priceUsd: payload.price_amount ?? null,
              paidAmount: payload.actually_paid ?? null,
              paidCurrency: payload.pay_currency ?? null,
            },
          },
        });
        await tx.cryptoPaymentOrder.update({
          where: { id: order.id },
          data: { capturedAt: new Date() },
        });
        // In-app notification.
        await tx.notification.create({
          data: {
            userId: order.userId,
            title: "Wallet topped up",
            body: `+${order.coins.toLocaleString("en-IN")} coins credited via crypto top-up.`,
            href: "/wallet",
          },
        });
      });
    } catch (e) {
      // P2002 on Transaction(kind, reference) → already credited.
      // Other errors should be surfaced for the admin to retry.
      const code = (e as { code?: string }).code;
      if (code === "P2002") {
        logger.info("duplicate IPN — wallet already credited", {
          orderId: order.id,
          paymentId,
        });
      } else {
        logger.error(e, {
          route: "/api/webhooks/nowpayments",
          orderId: order.id,
          paymentId,
        });
        // Don't 500 to NOWPayments — they retry on non-2xx and we
        // already updated the order status. The Settlement-style
        // retry surface in /admin/payouts will catch this.
      }
    }
  }

  return NextResponse.json({ ok: true });
}
