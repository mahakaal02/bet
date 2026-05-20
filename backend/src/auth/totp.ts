import * as crypto from 'crypto';

/**
 * RFC 6238 TOTP — 30-second window, 6-digit code, HMAC-SHA1.
 * Implemented directly so we don't add an otp library to the
 * supply chain for ~30 lines of well-specified math.
 *
 * `generate()` is exposed only to support spec / dev testing.
 * Production code uses `verify()` exclusively, which accepts the
 * current window plus the immediate neighbours so a code typed
 * across a window-rollover still validates (the ±1 window
 * tolerance is the standard recommendation in §5.2 of RFC 6238).
 *
 * Secrets are raw bytes here; `base32encode()` produces the
 * Google-Authenticator-compatible string used inside the
 * `otpauth://` URI we hand to QR-code generators.
 */

const STEP_SEC = 30;
const DIGITS = 6;

/** Produce a TOTP code for `secret` at the window enclosing `now`. */
export function generate(secret: Buffer, now = Date.now()): string {
  const counter = Math.floor(now / 1000 / STEP_SEC);
  return generateFromCounter(secret, counter);
}

/**
 * Validate `code` against `secret`. Accepts the current window
 * and ±1 (about a 90-second tolerance) — matches Google
 * Authenticator's behaviour and accommodates clock drift.
 *
 * Constant-time string compare guards against timing-side-channel
 * exfiltration of partial digits. Returns true on first match.
 */
export function verify(
  secret: Buffer,
  code: string,
  now = Date.now(),
): boolean {
  const trimmed = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(trimmed)) return false;

  const counter = Math.floor(now / 1000 / STEP_SEC);
  for (const offset of [0, -1, 1]) {
    const expected = generateFromCounter(secret, counter + offset);
    if (constantTimeEqual(expected, trimmed)) return true;
  }
  return false;
}

/**
 * `otpauth://` URI per the de-facto Key URI Format documented by
 * Google Authenticator. Issuer + account label are surfaced both
 * in the path and the issuer param (defence-in-depth for some
 * scanners that read only one).
 */
export function otpauthUri(input: {
  secret: Buffer;
  issuer: string;
  accountName: string;
}): string {
  const params = new URLSearchParams({
    secret: base32encode(input.secret),
    issuer: input.issuer,
    digits: String(DIGITS),
    period: String(STEP_SEC),
    algorithm: 'SHA1',
  });
  const path = encodeURIComponent(
    `${input.issuer}:${input.accountName}`,
  );
  return `otpauth://totp/${path}?${params.toString()}`;
}

/** RFC 4648 base32 (uppercase, no padding) — Google Authenticator format. */
export function base32encode(bytes: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += alphabet[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

/** Cryptographically random 20-byte secret — the standard TOTP size. */
export function randomSecret(): Buffer {
  return crypto.randomBytes(20);
}

// ─── Internals ────────────────────────────────────────────────────

function generateFromCounter(secret: Buffer, counter: number): string {
  // 8-byte big-endian counter.
  const buf = Buffer.alloc(8);
  // Counter fits inside Number range (≤ 2^53) for any post-1970 date.
  buf.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0);
  buf.writeUInt32BE(counter & 0xffffffff, 4);

  const hmac = crypto.createHmac('sha1', secret).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0x0f;
  const value =
    ((hmac[off] & 0x7f) << 24) |
    ((hmac[off + 1] & 0xff) << 16) |
    ((hmac[off + 2] & 0xff) << 8) |
    (hmac[off + 3] & 0xff);
  const code = value % 10 ** DIGITS;
  return code.toString().padStart(DIGITS, '0');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  return crypto.timingSafeEqual(aBuf, bBuf);
}
