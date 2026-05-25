import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { COIN_PACKS } from "@/lib/coin-packs";
import {
  createInvoice,
  isConfigured,
  ipnCallbackUrl,
  successReturnUrl,
  cancelReturnUrl,
} from "@/lib/nowpayments";

/**
 * POST /api/wallet/topup/crypto/order  (PR-BET-NOWPAYMENTS)
 * Body: { packId }
 *
 * Creates a NOWPayments hosted invoice for one of the coin packs and
 * a matching local `CryptoPaymentOrder` row. Returns the hosted
 * checkout URL — the client redirects there.
 *
 * INR → USD: NOWPayments only accepts a handful of fiat currencies on
 * the `price_currency` field; INR isn't one of them as of this PR. We
 * convert via a fixed rate (1 INR = $0.012 ≈ ₹83/$). This is a crude
 * approximation by design — the user is paying in crypto and seeing
 * the live INR price in the UI; minor fiat drift is acceptable for a
 * top-up flow that gets credited at exact coin parity (1 coin = 1 INR).
 * For a tighter rate, swap in a forex fetch (cached) in a follow-up.
 */

const Body = z.object({
  packId: z.string().min(1),
});

const INR_PER_USD = 83; // approximate; see above

export async function POST(req: Request) {
  const u = await getAuthedUser();
  if (!u) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isConfigured()) {
    return NextResponse.json(
      { error: "crypto top-ups are not enabled on this environment" },
      { status: 503 },
    );
  }
  // Per-user limit: 6 attempts / minute. Crypto invoice creation is
  // not free for NOWPayments and we want to catch loops fast.
  const limit = rateLimit(`crypto-order:${u.id}`, { limit: 6, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const pack = COIN_PACKS.find((p) => p.id === parsed.data.packId);
  if (!pack) {
    return NextResponse.json({ error: "unknown_pack" }, { status: 404 });
  }

  // Create the local order row FIRST so we have a stable `order_id`
  // to thread through the invoice. NOWPayments echoes this back on
  // every IPN — that's how the webhook handler maps a callback to
  // the right user without trusting the unauthenticated payload.
  const order = await db.cryptoPaymentOrder.create({
    data: {
      userId: u.id,
      packId: pack.id,
      amountInr: pack.priceInr,
      coins: pack.coins,
      status: "PENDING",
    },
  });

  // Round to 2dp so NOWPayments accepts it without re-quoting.
  const priceUsd = Math.max(1, Math.round((pack.priceInr / INR_PER_USD) * 100) / 100);

  let invoice;
  try {
    invoice = await createInvoice({
      orderId: order.id,
      priceAmount: priceUsd,
      priceCurrency: "usd",
      description: `Kalki Exchange — ${pack.coins.toLocaleString("en-IN")} coins (₹${pack.priceInr})`,
      ipnCallbackUrl: ipnCallbackUrl(),
      successUrl: successReturnUrl(order.id),
      cancelUrl: cancelReturnUrl(order.id),
    });
  } catch (e) {
    // Persist the failure for the admin payouts view; don't leave a
    // stuck PENDING row.
    await db.cryptoPaymentOrder.update({
      where: { id: order.id },
      data: { status: "FAILED", failureReason: (e as Error).message },
    });
    return NextResponse.json(
      { error: "invoice_creation_failed", detail: (e as Error).message },
      { status: 502 },
    );
  }

  await db.cryptoPaymentOrder.update({
    where: { id: order.id },
    data: {
      invoiceId: String(invoice.id),
      hostedInvoiceUrl: invoice.invoice_url,
      status: "WAITING",
    },
  });

  return NextResponse.json({
    orderId: order.id,
    invoiceId: String(invoice.id),
    redirectUrl: invoice.invoice_url,
  });
}
