import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { COIN_PACKS } from "@/lib/coin-packs";
import { MIN_TOPUP_COINS } from "@/lib/coins";
import {
  createInvoice,
  isConfigured,
  ipnCallbackUrl,
  successReturnUrl,
  cancelReturnUrl,
} from "@/lib/nowpayments";

const MAX_CUSTOM_COINS = 10_000_000;
const BACKEND = (
  process.env.AUCTIONS_BACKEND_URL ??
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  "http://localhost:4000"
).replace(/\/$/, "");

/** USD price per coin, from the US (baseline) 1000-coin pack. Used to
 *  quote a custom-amount crypto invoice — NOWPayments only takes a few
 *  fiat currencies on `price_currency`, so we always charge in USD. */
async function usdPerCoin(): Promise<number | null> {
  try {
    const res = await fetch(`${BACKEND}/pricing/current?country=US`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      packs?: Array<{ coins: number; price: string }>;
    };
    const p = body?.packs?.find((x) => x.coins === 1000);
    const v = p ? Number(p.price) : NaN;
    return Number.isFinite(v) && v > 0 ? v / 1000 : null;
  } catch {
    return null;
  }
}

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

const Body = z
  .object({
    packId: z.string().min(1).optional(),
    coins: z.number().int().min(MIN_TOPUP_COINS).max(MAX_CUSTOM_COINS).optional(),
  })
  .refine((b) => !!b.packId || typeof b.coins === "number", {
    message: "packId or coins required",
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
  // Resolve the order's coins + USD price: a known pack, or a custom
  // amount priced SERVER-SIDE (anti-arbitrage — never trust a client
  // fiat figure).
  let orderPackId: string;
  let orderCoins: number;
  let priceUsd: number;
  let amountInr: number;
  let description: string;
  if (parsed.data.packId) {
    const pack = COIN_PACKS.find((p) => p.id === parsed.data.packId);
    if (!pack) {
      return NextResponse.json({ error: "unknown_pack" }, { status: 404 });
    }
    orderPackId = pack.id;
    orderCoins = pack.coins;
    priceUsd = Math.max(1, Math.round((pack.priceInr / INR_PER_USD) * 100) / 100);
    amountInr = pack.priceInr;
    description = `Kalki Exchange — ${pack.coins.toLocaleString("en-IN")} coins (₹${pack.priceInr})`;
  } else {
    orderCoins = parsed.data.coins!;
    const perCoin = await usdPerCoin();
    if (perCoin == null) {
      return NextResponse.json({ error: "pricing_unavailable" }, { status: 503 });
    }
    orderPackId = "custom";
    priceUsd = Math.max(1, Math.round(orderCoins * perCoin * 100) / 100);
    amountInr = Math.round(priceUsd * INR_PER_USD);
    description = `Kalki Exchange — ${orderCoins.toLocaleString("en-IN")} coins (custom)`;
  }

  // Create the local order row FIRST so we have a stable `order_id`
  // to thread through the invoice. NOWPayments echoes this back on
  // every IPN — that's how the webhook handler maps a callback to
  // the right user without trusting the unauthenticated payload.
  const order = await db.cryptoPaymentOrder.create({
    data: {
      userId: u.id,
      packId: orderPackId,
      amountInr,
      coins: orderCoins,
      status: "PENDING",
    },
  });

  let invoice;
  try {
    invoice = await createInvoice({
      orderId: order.id,
      priceAmount: priceUsd,
      priceCurrency: "usd",
      description,
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
