import { NextResponse } from "next/server";
import { setSessionToken } from "@/lib/session";
import { verifyTelegramAuth } from "@/lib/telegram";

/**
 * GET /api/auth/telegram/callback?next=<path>&id=…&hash=…&…
 *
 * Telegram's OAuth flow finishes by 302-redirecting the browser
 * here with the signed user payload as query params. We:
 *
 *   1. HMAC-verify the payload against TELEGRAM_BOT_TOKEN (defense
 *      in depth — see step 2).
 *   2. POST the FULL Telegram payload (incl. `hash`, with original
 *      snake_case field names) to the auctions backend at
 *      `POST /auth/telegram`. The backend re-verifies the same
 *      HMAC against the same `TELEGRAM_BOT_TOKEN` — we share the
 *      env so neither side can be bypassed in isolation. The
 *      backend then upserts a user row keyed on the Telegram
 *      numeric ID and returns the same `{token, user}` shape that
 *      `/auth/login` returns.
 *   3. Set the `kalki_token` cookie and 303-redirect to `?next=`.
 *
 * BACKEND CONTRACT  ────────────────────────────────────────────
 *   POST {AUCTIONS_BACKEND_URL}/auth/telegram
 *   Body: TelegramAuthDto = {
 *     id: number,                  // Telegram numeric user id
 *     first_name: string,
 *     last_name?: string,
 *     username?: string,
 *     photo_url?: string,
 *     auth_date: number,           // unix seconds
 *     hash: string                 // 64-char HMAC-SHA256 hex
 *   }
 *   Response: 200 { token, user: { id, email|null, username,
 *                                  isAdmin, coinBalance } }
 *             or  4xx { message }
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const nextParam = url.searchParams.get("next") ?? "/";
  const next = nextParam.startsWith("/") ? nextParam : "/";

  // Behind Traefik path-routing, `req.url`'s origin is the pod's
  // internal listen address (e.g. http://localhost:3200) — redirecting
  // the browser there would land it on an unreachable URL. Prefer the
  // pinned NEXTAUTH_URL (= https://kalki.bet in prod) the same way the
  // start route does; fall back to req.url's origin for local dev.
  const publicOrigin = (
    process.env.NEXTAUTH_URL ?? url.origin
  ).replace(/\/$/, "");

  const payload = verifyTelegramAuth(
    url.searchParams,
    process.env.TELEGRAM_BOT_TOKEN,
  );
  if (!payload) {
    // We deliberately don't 4xx the user — they came from Telegram
    // and might not understand a JSON error. Render the failure on
    // the login page with an error toast slot in the query.
    const loginUrl = new URL("/login", publicOrigin);
    loginUrl.searchParams.set("error", "telegram_signature_invalid");
    return NextResponse.redirect(loginUrl.toString(), { status: 303 });
  }

  // Trade the verified Telegram identity for a backend JWT. We send
  // the EXACT Telegram payload (snake_case, including `hash`) so the
  // backend can re-run the same HMAC check — shared env means neither
  // side can be bypassed in isolation.
  const backendUrl =
    process.env.AUCTIONS_BACKEND_URL ?? "http://localhost:4000";
  const forwardBody: Record<string, string | number> = {
    id: payload.id,
    first_name: payload.first_name,
    auth_date: payload.auth_date,
    hash: payload.hash,
  };
  if (payload.last_name !== undefined)
    forwardBody.last_name = payload.last_name;
  if (payload.username !== undefined) forwardBody.username = payload.username;
  if (payload.photo_url !== undefined)
    forwardBody.photo_url = payload.photo_url;

  try {
    const res = await fetch(`${backendUrl}/auth/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(forwardBody),
      cache: "no-store",
    });

    if (!res.ok) {
      // Backend missing or rejecting — surface a clear error code on
      // the login page so the visible failure is actionable.
      const errCode =
        res.status === 404
          ? "telegram_backend_missing"
          : "telegram_auth_failed";
      const loginUrl = new URL("/login", publicOrigin);
      loginUrl.searchParams.set("error", errCode);
      return NextResponse.redirect(loginUrl.toString(), { status: 303 });
    }

    const sessionBody = (await res.json()) as { token?: string };
    if (!sessionBody.token) {
      const loginUrl = new URL("/login", publicOrigin);
      loginUrl.searchParams.set("error", "telegram_token_missing");
      return NextResponse.redirect(loginUrl.toString(), { status: 303 });
    }

    await setSessionToken(sessionBody.token);
    return NextResponse.redirect(new URL(next, publicOrigin).toString(), {
      status: 303,
    });
  } catch {
    const loginUrl = new URL("/login", publicOrigin);
    loginUrl.searchParams.set("error", "telegram_network_error");
    return NextResponse.redirect(loginUrl.toString(), { status: 303 });
  }
}
