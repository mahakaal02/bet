/**
 * Server-to-server auth for the `/api/internal/*` namespace.
 *
 * Kalki Bet's wallet is the canonical balance for every game on the
 * platform. The auctions backend (NestJS) and the Aviator service both
 * call into this app whenever they need to debit (place bid / start round)
 * or credit (win auction / cash out) a player's coins.
 *
 * Those callers don't have a NextAuth session cookie — they have a shared
 * secret in the `INTERNAL_API_SECRET` env var. Compared constant-time so a
 * timing-attack against the secret string isn't viable.
 */
import { timingSafeEqual } from "crypto";

export interface InternalAuthResult {
  ok: boolean;
  reason?: "missing_secret" | "missing_header" | "bad_secret";
}

export function checkInternalSecret(req: Request): InternalAuthResult {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) return { ok: false, reason: "missing_secret" };

  const header = req.headers.get("authorization");
  if (!header) return { ok: false, reason: "missing_header" };

  const presented = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (presented.length !== expected.length) {
    // Length leak is fine — Node strings compare-by-length is O(1) and
    // timingSafeEqual requires equal-length buffers anyway.
    return { ok: false, reason: "bad_secret" };
  }
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  return timingSafeEqual(a, b)
    ? { ok: true }
    : { ok: false, reason: "bad_secret" };
}
