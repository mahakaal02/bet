/**
 * Razorpay client wrapper. Lazy-imported via a string specifier so the
 * `razorpay` package only resolves at runtime — keeps test environments
 * dependency-light and lets us probe `isConfigured()` without throwing.
 *
 * The platform is real-money: 1 coin = ₹1. Every coin top-up MUST flow
 * through this client in production. The placeholder instant-credit path
 * in /api/wallet/topup is gated behind `ALLOW_INSTANT_TOPUP=true` and is
 * intended only for local development where Razorpay keys aren't set.
 */
import { createHmac, timingSafeEqual } from "crypto";

interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt?: string;
  status: string;
}

interface RazorpayClient {
  orders: {
    create(opts: {
      amount: number;
      currency: string;
      receipt: string;
      payment_capture?: boolean | 0 | 1;
    }): Promise<RazorpayOrder>;
  };
}

const globalForRzp = globalThis as unknown as {
  __betRzp?: RazorpayClient | null;
  __betRzpAttempted?: boolean;
};

async function maybeBuildClient(): Promise<RazorpayClient | null> {
  if (globalForRzp.__betRzpAttempted) return globalForRzp.__betRzp ?? null;
  globalForRzp.__betRzpAttempted = true;

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;

  // The `razorpay` package is CJS-only. A static `import "razorpay"` is
  // the spelling Next 15 / webpack reliably resolves; the prior variable-
  // string form silently failed at bundle time. We surface any underlying
  // load error to the log instead of swallowing it so debugging is easier.
  let mod: unknown;
  try {
    mod = await import("razorpay");
  } catch (err) {
    console.error(
      "[razorpay] failed to load `razorpay` package. If installed, this usually means a bundler resolution issue. Underlying error:",
      err,
    );
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = mod as any;
  const Ctor = m.default ?? m;
  globalForRzp.__betRzp = new Ctor({ key_id: keyId, key_secret: keySecret });
  return globalForRzp.__betRzp ?? null;
}

export function isConfigured(): boolean {
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export function publicKeyId(): string | null {
  return process.env.RAZORPAY_KEY_ID ?? null;
}

/** Throws ServiceUnavailable equivalent when Razorpay isn't configured. */
export async function createOrder(
  amountInPaise: number,
  receipt: string,
): Promise<RazorpayOrder> {
  const client = await maybeBuildClient();
  if (!client) throw new Error("razorpay_not_configured");
  return client.orders.create({
    amount: amountInPaise,
    currency: "INR",
    receipt,
    payment_capture: true,
  });
}

/**
 * Verify the signature Razorpay returns on the client side after a
 * successful Checkout flow. Constant-time compare.
 *
 *   sig = HMAC_SHA256(key_secret, order_id + "|" + payment_id)
 */
export function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  const expected = createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  let b: Buffer;
  try {
    b = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verify the signature on a Razorpay webhook payload. The secret here is
 * `RAZORPAY_WEBHOOK_SECRET` (distinct from key_secret) — configured in
 * the Razorpay dashboard's webhook settings.
 *
 *   sig = HMAC_SHA256(webhook_secret, raw_body)
 *
 * `rawBody` must be the *bytes* Razorpay sent, not a re-serialised JSON —
 * even key ordering differences break the HMAC. Next route handlers
 * receive the raw body via req.text().
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "hex");
  let b: Buffer;
  try {
    b = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
