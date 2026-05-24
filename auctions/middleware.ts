import { NextResponse, type NextRequest } from "next/server";
import {
  LOGGED_OUT_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/session";

/**
 * SSO bridge: when a request arrives with `?token=<JWT>`, consume it.
 *
 * The Android shell + the Kalki Hub both pass the user's backend JWT to
 * a webview via this query parameter — exactly the same handshake the
 * Bet app uses via its TokenBridge component. We intercept it at the
 * edge:
 *
 *   1. Read the token off the URL.
 *   2. Set it as our `kalki_token` HTTP-only cookie (with the same
 *      flags `setSessionToken` would use server-side).
 *   3. Rewrite the URL to drop the token from the query string + the
 *      browser bar — both for hygiene (don't share tokens via link)
 *      and so a refresh doesn't keep replaying the SSO step.
 *
 * Just-logged-out guard (PR-WEB-LOGOUT-FIX):
 *
 *   If the `kalki_logged_out` cookie is present, we DO NOT honour the
 *   `?token=` param — we just strip it from the URL and continue
 *   without setting any session cookie. This blocks the "I clicked
 *   Sign out, then a stale bookmark / hub-tile / Android intent with
 *   `?token=…` re-logs me in" failure mode users were hitting.
 *
 *   The guard cookie has a short TTL (60s, see `lib/session.ts
 *   LOGGED_OUT_MAX_AGE_SECONDS`). After that window the SSO bridge
 *   resumes normal behaviour — a legitimate fresh sign-in (e.g. via
 *   the Android shell which always carries a freshly-minted token)
 *   works again.
 *
 * The token's HMAC validity is checked the first time the page calls
 * the backend (`/auth/me`). A forged token quietly fails there and
 * bounces the user to /login — never trust the URL param past the
 * cookie hop.
 *
 * Matcher excludes API + static assets so we never touch automated
 * pipelines (curl-driven topup-token fetch, Next image optimisation,
 * etc.).
 */
export function middleware(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.next();

  const justLoggedOut = req.cookies.get(LOGGED_OUT_COOKIE)?.value === "1";

  const url = req.nextUrl.clone();
  url.searchParams.delete("token");

  if (justLoggedOut) {
    // Strip the token from the URL but DO NOT set a session cookie.
    // The user explicitly logged out within the last 60s — they
    // shouldn't be silently re-signed-in by a stale URL param.
    return NextResponse.redirect(url);
  }

  const res = NextResponse.redirect(url);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}

export const config = {
  // Skip static + framework routes. Anything user-facing routes through.
  matcher: ["/((?!_next|favicon.ico|api/auth/token).*)"],
};
