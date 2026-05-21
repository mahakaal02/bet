import { NextResponse } from "next/server";
import { SESSION_COOKIE, clearSessionToken } from "@/lib/session";

/**
 * GET /api/auth/sso-logout?next=<url>
 *
 * Cross-app sign-out hop for Auctions. Same shape as Bet's
 * `/api/auth/sso-logout` (clear-then-303-redirect) — added so the
 * cross-game logout chains kicked off from Aviator or Bet can also
 * clear the auctions `kalki_token` cookie before landing on
 * `/login`.
 *
 * Why this matters: the auctions `/login` page checks the session
 * cookie and redirects signed-in users back to `/` (the hub). If
 * the chain hops Bet → Aviator → Auctions /login without clearing
 * the auctions cookie along the way, the user bounces straight
 * back to the hub instead of seeing the login form.
 *
 * Why we can't just call the existing POST /api/auth/logout from
 * other origins: it's POST-only (which is the right shape for
 * same-origin user-initiated sign-out, since you can't trigger a
 * POST from a top-level GET navigation without a form). For
 * cross-origin chains the browser is following 303s, so the hops
 * have to be GET.
 *
 * Safe-redirect note: only http(s) URLs are honoured. Any other
 * scheme (`javascript:`, `data:`, etc.) is rejected and we send
 * the user to `/login` instead.
 */
export const runtime = "nodejs";

const FALLBACK_NEXT = "/login";

function safeNext(raw: string | null): string {
  if (!raw) return FALLBACK_NEXT;
  // Allow same-origin paths (`/foo`) verbatim; for absolute URLs
  // require http(s).
  if (raw.startsWith("/")) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
    return FALLBACK_NEXT;
  } catch {
    return FALLBACK_NEXT;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));

  // Clear our cookie via the shared helper. `clearSessionToken`
  // already uses the same options the cookie was set with, so the
  // browser actually drops it (vs leaving a zombie).
  await clearSessionToken();

  const res = NextResponse.redirect(next, { status: 303 });
  // Belt-and-braces — explicit Set-Cookie with maxAge=0 in case the
  // request landed on a different Next.js worker than the one that
  // set the cookie (cookies.delete is per-response, not global).
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
