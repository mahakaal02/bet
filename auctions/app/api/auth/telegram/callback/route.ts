import { NextResponse } from "next/server";
import { setSessionToken } from "@/lib/session";
import { verifyTelegramAuth } from "@/lib/telegram";

/**
 * GET /api/auth/telegram/callback?next=<path>&id=…&hash=…&…
 *
 * Telegram's OAuth flow finishes by 302-redirecting the browser
 * here with the signed user payload as query params. We:
 *
 *   1. HMAC-verify the payload against TELEGRAM_BOT_TOKEN.
 *   2. POST the verified user to the auctions backend at
 *      `POST /auth/telegram` which is expected to upsert a user
 *      row keyed on the Telegram numeric ID and return the same
 *      `{token, user}` shape `/auth/login` returns. New backend
 *      endpoint — see BACKEND CONTRACT below.
 *   3. Set the `kalki_token` cookie and 302-redirect to `?next=`.
 *
 * BACKEND CONTRACT  ────────────────────────────────────────────
 *   POST {AUCTIONS_BACKEND_URL}/auth/telegram
 *   Body: {
 *     telegramId: number,
 *     username: string | null,
 *     firstName: string,
 *     lastName: string | null,
 *     photoUrl: string | null,
 *     authDate: number          // unix seconds
 *   }
 *   Response: 200 { token, user: { id, email|null, username,
 *                                  isAdmin, coinBalance } }
 *             or  4xx { message }
 *
 * Once the backend implements the endpoint, no further changes
 * are needed here. Until then, this route returns a clear 503 so
 * QA notices the missing dependency.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const nextParam = url.searchParams.get("next") ?? "/";
  const next = nextParam.startsWith("/") ? nextParam : "/";

  const payload = verifyTelegramAuth(
    url.searchParams,
    process.env.TELEGRAM_BOT_TOKEN,
  );
  if (!payload) {
    // We deliberately don't 4xx the user — they came from Telegram
    // and might not understand a JSON error. Render the failure on
    // the login page with an error toast slot in the query.
    const loginUrl = new URL("/login", url.origin);
    loginUrl.searchParams.set("error", "telegram_signature_invalid");
    return NextResponse.redirect(loginUrl.toString(), { status: 303 });
  }

  // Trade the verified Telegram identity for a backend JWT.
  const backendUrl =
    process.env.AUCTIONS_BACKEND_URL ?? "http://localhost:4000";
  try {
    const res = await fetch(`${backendUrl}/auth/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        telegramId: payload.id,
        username: payload.username ?? null,
        firstName: payload.first_name,
        lastName: payload.last_name ?? null,
        photoUrl: payload.photo_url ?? null,
        authDate: payload.auth_date,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      // Backend missing or rejecting — surface a clear error code on
      // the login page so the visible failure is actionable.
      const errCode =
        res.status === 404
          ? "telegram_backend_missing"
          : "telegram_auth_failed";
      const loginUrl = new URL("/login", url.origin);
      loginUrl.searchParams.set("error", errCode);
      return NextResponse.redirect(loginUrl.toString(), { status: 303 });
    }

    const body = (await res.json()) as { token?: string };
    if (!body.token) {
      const loginUrl = new URL("/login", url.origin);
      loginUrl.searchParams.set("error", "telegram_token_missing");
      return NextResponse.redirect(loginUrl.toString(), { status: 303 });
    }

    await setSessionToken(body.token);
    return NextResponse.redirect(new URL(next, url.origin).toString(), {
      status: 303,
    });
  } catch {
    const loginUrl = new URL("/login", url.origin);
    loginUrl.searchParams.set("error", "telegram_network_error");
    return NextResponse.redirect(loginUrl.toString(), { status: 303 });
  }
}
