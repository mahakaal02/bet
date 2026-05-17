import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/session";

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

  const url = req.nextUrl.clone();
  url.searchParams.delete("token");
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
