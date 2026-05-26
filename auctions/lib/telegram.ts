/**
 * Telegram Login Widget — server-side signature verification.
 *
 * Spec: https://core.telegram.org/widgets/login#checking-authorization
 *
 * Telegram's web login widget posts (or redirects with) a set of
 * query params describing the user:
 *
 *   id, first_name, last_name?, username?, photo_url?, auth_date, hash
 *
 * To prove the payload came from Telegram (and not an attacker),
 * every field except `hash` is concatenated as `key=value` lines
 * sorted alphabetically, joined with `\n`, then HMAC-SHA256-signed
 * with SHA256(BOT_TOKEN) as the key. The resulting hex digest is
 * compared to the `hash` field.
 *
 * We also reject payloads older than 24 hours to make replay
 * attacks expensive — Telegram's docs recommend this window.
 *
 * Env (server-only):
 *   TELEGRAM_BOT_TOKEN     — the bot token from @BotFather. NEVER
 *                            expose to the client; if leaked, an
 *                            attacker can sign arbitrary payloads
 *                            and impersonate Kalki users.
 *
 * Public env (safe in client bundles):
 *   NEXT_PUBLIC_TELEGRAM_BOT — bot @username (without the @). Used
 *                              to construct the Telegram Login
 *                              Widget URL.
 */

import crypto from "node:crypto";

export interface TelegramAuthPayload {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

/**
 * Maximum acceptable age of the `auth_date` timestamp. 24h matches
 * Telegram's documented recommendation. Older payloads are rejected
 * so a captured callback URL can't be replayed forever.
 */
const AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * Verify a Telegram Login Widget callback against the bot's secret.
 *
 * Returns the verified payload on success, or `null` if the
 * signature doesn't check out (do NOT log the payload contents on
 * failure — that's how leaks happen).
 *
 *   const p = verifyTelegramAuth(searchParams, env.TELEGRAM_BOT_TOKEN);
 *   if (!p) return badRequest();
 *   // p.id, p.username, p.first_name, ... are now trusted.
 */
export function verifyTelegramAuth(
  /** Either a `URLSearchParams` or a plain `Record<string, string>` —
   *  Next.js searchParams from a route handler. */
  source: URLSearchParams | Record<string, string | string[] | undefined>,
  botToken: string | undefined,
): TelegramAuthPayload | null {
  if (!botToken) return null;

  // Normalise to a flat string-valued record.
  const data: Record<string, string> = {};
  if (source instanceof URLSearchParams) {
    for (const [k, v] of source.entries()) {
      // Telegram never sends array params — last value wins on
      // duplicates, but in practice there's only one.
      data[k] = v;
    }
  } else {
    for (const [k, v] of Object.entries(source)) {
      if (v === undefined) continue;
      data[k] = Array.isArray(v) ? (v[0] ?? "") : v;
    }
  }

  const receivedHash = data["hash"];
  if (!receivedHash || typeof receivedHash !== "string") return null;

  // Build the canonical signing string: every field except `hash`,
  // sorted alphabetically by key, joined with newlines.
  const dataCheckString = Object.keys(data)
    .filter((k) => k !== "hash")
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join("\n");

  // The key is SHA256(BOT_TOKEN). Per Telegram's spec — they don't
  // use the bot token directly as the HMAC key.
  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const computed = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  // Constant-time compare to defeat timing side channels.
  if (!safeEqual(computed, receivedHash)) return null;

  // Parse / sanity-check the structured fields.
  const id = Number(data["id"]);
  if (!Number.isFinite(id) || id <= 0) return null;

  const authDate = Number(data["auth_date"]);
  if (!Number.isFinite(authDate)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (authDate > now + 60) return null; // clock skew tolerance forward
  if (now - authDate > AUTH_MAX_AGE_SECONDS) return null;

  const firstName = data["first_name"];
  if (!firstName) return null;

  return {
    id,
    first_name: firstName,
    last_name: data["last_name"] || undefined,
    username: data["username"] || undefined,
    photo_url: data["photo_url"] || undefined,
    auth_date: authDate,
    hash: receivedHash,
  };
}

/**
 * Constant-time string comparison. Built-in `===` short-circuits
 * on the first mismatched byte which leaks the length of the
 * common prefix via timing; `timingSafeEqual` doesn't.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(a, "utf8"),
      Buffer.from(b, "utf8"),
    );
  } catch {
    return false;
  }
}

/**
 * Bot username (without @) used to build the Telegram OAuth flow's
 * widget URL. Read from `NEXT_PUBLIC_TELEGRAM_BOT` so the same
 * value is available server- and client-side.
 */
export function telegramBotUsername(): string | null {
  const raw = process.env.NEXT_PUBLIC_TELEGRAM_BOT?.trim();
  if (!raw) return null;
  return raw.replace(/^@/, "");
}

/**
 * Whether Telegram login is fully configured for this environment.
 * Both the public bot username AND the server-side secret must be
 * present — without either, the auth round-trip can't complete.
 */
export function isTelegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN && !!telegramBotUsername();
}
