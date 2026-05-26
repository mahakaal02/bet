import { NextResponse } from "next/server";
import { isTelegramConfigured } from "@/lib/telegram";

/**
 * GET /api/auth/telegram/start?next=<path>
 *
 * Hands off to Telegram's OAuth flow. Telegram doesn't have a true
 * server-to-server OAuth; their docs describe two integration
 * patterns:
 *
 *   1. **Widget mode** — embed `<script src="telegram.org/js/telegram-widget.js">`.
 *      Loads an iframe popup, calls back into your JS on success.
 *      Pro: drop-in. Con: requires the bot's username to be set as
 *      the widget's `data-telegram-login` attribute, can't be
 *      proxied server-side.
 *
 *   2. **Web auth redirect** — point the browser at
 *      `https://oauth.telegram.org/auth?bot_id=…&origin=…&return_to=…`.
 *      Telegram renders its own login page (phone + code), then
 *      302-redirects back to our `return_to` with `id`, `first_name`,
 *      `last_name`, `username`, `photo_url`, `auth_date`, `hash`.
 *
 * We use the redirect path because:
 *   • No client-side script tag (smaller bundle).
 *   • CSP is easier — only one outbound origin (oauth.telegram.org).
 *   • Works inside webview wrappers that block iframes.
 *
 * The `next` query is captured into the `state` slot so the
 * callback knows where to land the user after we mint the session.
 */
export async function GET(req: Request) {
  if (!isTelegramConfigured()) {
    // Friendly error so QA notices the env var is missing instead
    // of staring at a "redirected to telegram, got nothing back".
    return NextResponse.json(
      {
        ok: false,
        message:
          "Telegram login is not configured. Set TELEGRAM_BOT_TOKEN + NEXT_PUBLIC_TELEGRAM_BOT in the env.",
      },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const nextParam = url.searchParams.get("next") ?? "/";
  // Only allow same-origin next values — never redirect to attacker-
  // controlled URLs after a sign-in.
  const next = nextParam.startsWith("/") ? nextParam : "/";

  // Bot ID is the numeric prefix of the token (e.g. "1234567890:ABC…"
  // → "1234567890"). Telegram's web-auth endpoint wants the numeric
  // ID, not the @username.
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const botId = token.split(":")[0];

  // Origin we want Telegram to redirect back to. Reads NEXTAUTH_URL
  // (the canonical hub origin in the rest of the auctions app) with
  // a localhost fallback for local dev.
  const origin = (
    process.env.NEXTAUTH_URL ?? `${url.protocol}//${url.host}`
  ).replace(/\/$/, "");
  const returnTo = `${origin}/api/auth/telegram/callback?next=${encodeURIComponent(next)}`;

  const tgUrl = new URL("https://oauth.telegram.org/auth");
  tgUrl.searchParams.set("bot_id", botId);
  tgUrl.searchParams.set("origin", origin);
  tgUrl.searchParams.set("embed", "0");
  tgUrl.searchParams.set("request_access", "write");
  tgUrl.searchParams.set("return_to", returnTo);

  return NextResponse.redirect(tgUrl.toString(), { status: 303 });
}
