import { NextResponse } from "next/server";
import { hubLoginUrl } from "@/lib/hub";

/**
 * GET /api/auth/sso-logout?next=<url>
 *
 * Cross-app sign-out hop for Bet. Clears the NextAuth session cookie
 * then 303-redirects to `?next=`. Unlike NextAuth's built-in
 * `/api/auth/signout`, this is GET-only (so chained redirects from
 * other origins work without a CSRF token) and accepts an explicit
 * `next` query so the caller can chain through Aviator's logout next.
 *
 * Why we can't just call NextAuth's signout: that endpoint is
 * POST-only and CSRF-gated, which makes cross-origin chained logout
 * impossible without injecting a form on every origin.
 *
 * Default `next` is the hub's login page (PR-SINGLE-LOGIN) — bet no
 * longer hosts its own /login, so post-logout users land on the
 * canonical sign-in surface at auctions instead.
 */

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next") ?? hubLoginUrl();

  // Default NextAuth cookie name (HTTPS production prefixes with __Secure-).
  const isSecure = process.env.NODE_ENV === "production";
  const cookieName = isSecure
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token";

  const res = NextResponse.redirect(next, { status: 303 });
  // Clear the session cookie by setting it expired. `cookies.delete`
  // would also work but explicit empty value with maxAge=0 is more
  // portable across browsers.
  res.cookies.set(cookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure,
    path: "/",
    maxAge: 0,
  });
  // Also clear the CSRF cookie + callback-url cookie that NextAuth
  // sometimes leaves behind — belt-and-braces, harmless if absent.
  res.cookies.set("next-auth.csrf-token", "", { path: "/", maxAge: 0 });
  res.cookies.set("next-auth.callback-url", "", { path: "/", maxAge: 0 });
  if (isSecure) {
    res.cookies.set("__Host-next-auth.csrf-token", "", { path: "/", maxAge: 0 });
    res.cookies.set("__Secure-next-auth.callback-url", "", {
      path: "/",
      maxAge: 0,
    });
  }
  // PR-WEB-LOGOUT-FIX — set the just-logged-out guard cookie on bet's
  // origin. bet's middleware checks for this and refuses to re-sign-in
  // a user from a `?token=` URL param within 60s of logout. Stops the
  // "I logged out but a tile click signs me right back in" loop.
  res.cookies.set("kalki_logged_out", "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure,
    path: "/",
    maxAge: 60,
  });
  return res;
}
