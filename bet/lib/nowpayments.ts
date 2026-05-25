/**
 * NOWPayments API client (PR-BET-NOWPAYMENTS).
 *
 * Thin wrapper around the NOWPayments REST surface. Two flows we
 * actually use:
 *
 *   1. Hosted invoice — `POST /v1/invoice` returns a redirect URL. The
 *      user clicks "Buy" → we redirect to NOWPayments → user pays in
 *      their preferred coin → NOWPayments POSTs an IPN to our webhook
 *      → we credit the wallet. The user lands back on our `success`
 *      page. This is what `BuyCoinsGrid` triggers.
 *
 *   2. IPN verification — every callback carries an `x-nowpayments-sig`
 *      header (HMAC-SHA512 of the raw body using IPN_SECRET). The
 *      webhook handler MUST verify this before trusting any
 *      `payment_status` value, otherwise an unauthenticated POST can
 *      mint coins. See `verifyIpnSignature` below.
 *
 * Sandbox vs prod is gated on `NOWPAYMENTS_SANDBOX=true|false`.
 *
 * Environment variables:
 *
 *   NOWPAYMENTS_API_KEY      x-api-key header on every outbound call.
 *                            Required for the integration to be
 *                            "configured" — `isConfigured()` reads
 *                            this.
 *   NOWPAYMENTS_IPN_SECRET   HMAC-SHA512 key for callback verification.
 *                            REQUIRED in production — refuses to start
 *                            crediting wallets if missing.
 *   NOWPAYMENTS_SANDBOX      "true" routes to api-sandbox.nowpayments.io.
 *                            Default false → production.
 *   NEXTAUTH_URL             Used to build the IPN callback URL +
 *                            the user-facing success/cancel return
 *                            URLs.
 *
 * Currency model: NOWPayments quotes invoices in fiat (USD by default).
 * Coin packs are priced in INR. We do INR → USD → crypto via the
 * invoice creation step — NOWPayments handles the FX. Receipts still
 * show INR (we store `amountInr` on the CryptoPaymentOrder row); the
 * user's actual paid amount in their chosen coin is captured on the
 * IPN callback for the admin's audit view.
 */

import { createHmac, timingSafeEqual } from "crypto";

const SANDBOX_BASE = "https://api-sandbox.nowpayments.io/v1";
const PROD_BASE = "https://api.nowpayments.io/v1";

function baseUrl(): string {
  return process.env.NOWPAYMENTS_SANDBOX === "true" ? SANDBOX_BASE : PROD_BASE;
}

/**
 * True when the integration is configured enough to make API calls.
 * Webhook verification additionally requires `NOWPAYMENTS_IPN_SECRET`;
 * see `isFullyConfigured` if you need to assert both before crediting.
 */
export function isConfigured(): boolean {
  return !!process.env.NOWPAYMENTS_API_KEY;
}

/**
 * Stricter check — both API key AND IPN secret. Webhook handlers
 * should refuse to credit wallets if this returns false, because
 * without IPN_SECRET there's no way to verify the callback came from
 * NOWPayments and not from an attacker.
 */
export function isFullyConfigured(): boolean {
  return !!process.env.NOWPAYMENTS_API_KEY && !!process.env.NOWPAYMENTS_IPN_SECRET;
}

interface NowFetchOpts {
  method?: "GET" | "POST";
  body?: unknown;
}

async function npFetch<T>(path: string, opts: NowFetchOpts = {}): Promise<T> {
  const key = process.env.NOWPAYMENTS_API_KEY;
  if (!key) throw new Error("NOWPAYMENTS_API_KEY missing");
  const res = await fetch(`${baseUrl()}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "x-api-key": key,
      "Content-Type": "application/json",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    // No caching — payment state has to be live.
    cache: "no-store",
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`NOWPayments returned non-JSON (${res.status}): ${text.slice(0, 120)}`);
  }
  if (!res.ok) {
    // NOWPayments error shape: { statusCode, message, code? }
    const err = parsed as { message?: string; code?: string };
    throw new Error(
      `NOWPayments ${path} failed (${res.status}): ${err.message ?? text.slice(0, 120)}`,
    );
  }
  return parsed as T;
}

/* ============================================================
   Public API
   ============================================================ */

/**
 * `GET /v1/status` — health check. Returns `{ message: "OK" }`.
 * Useful as a precondition gate before exposing the crypto path on
 * the wallet page (we don't want users clicking Buy only to see a
 * 502 from upstream).
 */
export async function pingStatus(): Promise<boolean> {
  try {
    const r = await npFetch<{ message?: string }>("/status");
    return r.message === "OK";
  } catch {
    return false;
  }
}

export interface NowInvoice {
  id: string;
  order_id: string;
  order_description: string | null;
  price_amount: number;
  price_currency: string;
  // The hosted checkout URL we redirect users to.
  invoice_url: string;
  created_at: string;
  updated_at: string;
}

/**
 * Create a hosted-checkout invoice. The user picks their coin on
 * the NOWPayments-hosted page; we get an IPN once payment finishes.
 *
 *   orderId        — our local CryptoPaymentOrder.id (echoed back in
 *                    IPN payloads as `order_id`)
 *   priceAmount    — fiat amount (we use USD; NOWPayments converts
 *                    INR → USD with their rate. Most reliable on
 *                    the integration side.)
 *   priceCurrency  — "usd" by default.
 *   description    — appears on the hosted checkout page.
 *   ipnCallbackUrl — POST destination for the IPN.
 *   successUrl     — where the user lands after payment.
 *   cancelUrl      — where the user lands if they bail.
 */
export async function createInvoice(args: {
  orderId: string;
  priceAmount: number;
  priceCurrency?: string;
  description?: string;
  ipnCallbackUrl: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<NowInvoice> {
  return npFetch<NowInvoice>("/invoice", {
    method: "POST",
    body: {
      price_amount: args.priceAmount,
      price_currency: args.priceCurrency ?? "usd",
      order_id: args.orderId,
      order_description: args.description ?? "Kalki Exchange wallet top-up",
      ipn_callback_url: args.ipnCallbackUrl,
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
    },
  });
}

export interface NowPayment {
  payment_id: string;
  payment_status: NowPaymentStatus;
  pay_address: string;
  price_amount: number;
  price_currency: string;
  pay_amount: number | string;
  actually_paid: number | string;
  pay_currency: string;
  order_id: string;
  order_description: string | null;
  purchase_id?: string;
  created_at: string;
  updated_at: string;
  outcome_amount?: number;
  outcome_currency?: string;
}

/**
 * Status values lifted from NOWPayments docs. We narrow to a union so
 * the webhook handler can switch exhaustively.
 *
 *   waiting          — invoice created, user hasn't paid yet
 *   confirming       — payment seen on-chain, awaiting confirmations
 *   confirmed        — confirmed but not yet exchanged to our coin
 *   sending          — sending to merchant wallet
 *   partially_paid   — user sent less than required (common)
 *   finished         — fully done — this is when we credit wallet
 *   failed           — terminal failure
 *   refunded         — refunded by NOWPayments
 *   expired          — invoice timed out
 */
export type NowPaymentStatus =
  | "waiting"
  | "confirming"
  | "confirmed"
  | "sending"
  | "partially_paid"
  | "finished"
  | "failed"
  | "refunded"
  | "expired";

export async function getPayment(paymentId: string): Promise<NowPayment> {
  return npFetch<NowPayment>(`/payment/${encodeURIComponent(paymentId)}`);
}

/* ============================================================
   IPN signature verification
   ============================================================ */

/**
 * Verify the `x-nowpayments-sig` header against the raw request body.
 *
 *   - body MUST be the exact bytes that NOWPayments POSTed (no JSON
 *     re-parsing / re-stringifying). We use `await req.text()` in the
 *     handler and pass it straight here.
 *   - The HMAC is computed over the body sorted by key alphabetically
 *     at every nesting level. That's the NOWPayments quirk — they
 *     mention it in their docs.
 *
 * Returns true only when:
 *   - IPN_SECRET is configured
 *   - Header is present and matches
 *
 * Returns false (NEVER throws) so the caller's failure-path is a
 * single `if (!ok) return 401`.
 */
export function verifyIpnSignature(rawBody: string, header: string | null): boolean {
  if (!header) return false;
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return false;
  }
  const sortedJson = JSON.stringify(sortKeys(parsed));
  const expected = createHmac("sha512", secret).update(sortedJson).digest("hex");
  // timingSafeEqual requires same-length buffers — guard the length
  // before comparing so a short header doesn't throw.
  const expBuf = Buffer.from(expected);
  const gotBuf = Buffer.from(header);
  if (expBuf.length !== gotBuf.length) return false;
  return timingSafeEqual(expBuf, gotBuf);
}

/**
 * Recursive alphabetic key sort for nested objects/arrays.
 * NOWPayments' HMAC scheme requires this exact normalisation —
 * a JSON re-serialisation with default key order will produce a
 * different signature than what they computed.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeys(obj[key]);
    }
    return out;
  }
  return value;
}

/**
 * Convenience: build the IPN URL for the current deployment from
 * NEXTAUTH_URL (always set in helm/templates/bet.yaml). Falls back to
 * localhost for dev.
 */
export function ipnCallbackUrl(): string {
  const base = (process.env.NEXTAUTH_URL ?? "http://localhost:3100").replace(/\/$/, "");
  return `${base}/api/webhooks/nowpayments`;
}

export function successReturnUrl(orderId: string): string {
  const base = (process.env.NEXTAUTH_URL ?? "http://localhost:3100").replace(/\/$/, "");
  return `${base}/wallet/topup/return?order=${encodeURIComponent(orderId)}&result=success`;
}

export function cancelReturnUrl(orderId: string): string {
  const base = (process.env.NEXTAUTH_URL ?? "http://localhost:3100").replace(/\/$/, "");
  return `${base}/wallet/topup/return?order=${encodeURIComponent(orderId)}&result=cancel`;
}

/**
 * Map NOWPayments status → our CryptoPaymentOrder.status. The local
 * enum is just the upper-cased upstream value with one bookend
 * ("PENDING") for the brief window after we insert the order row but
 * before NOWPayments has acknowledged the invoice.
 */
export function normaliseStatus(s: NowPaymentStatus): string {
  return s.toUpperCase();
}

/**
 * Should we credit the wallet for this status? True only on
 * "finished". Partial payments and refunds need admin attention.
 */
export function isCreditable(status: string): boolean {
  return status === "FINISHED";
}
