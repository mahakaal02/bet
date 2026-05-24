/**
 * Tiny session layer for the Auctions app. Single concept: a cookie
 * called `kalki_token` holding the backend JWT. No NextAuth, no
 * Postgres — auth state lives on the auctions backend (port 4000),
 * we just carry its bearer token in an HTTP-only cookie so server
 * components can call upstream APIs as the right user.
 *
 *   - Set on POST /api/auth/login (which proxies to backend /auth/login).
 *   - Cleared on POST /api/auth/logout.
 *   - Read on every server-rendered page that needs auth.
 *
 * The cookie is HTTP-only + SameSite=Lax so the JS bundle never sees
 * the raw JWT (less XSS exposure) and cross-site form posts can't
 * impersonate the user.
 */
import { cookies } from "next/headers";

export const SESSION_COOKIE = "kalki_token";
// 7 days — matches the backend's default `JWT_EXPIRES_IN`. After that
// the upstream rejects the bearer and we redirect to /login.
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export interface SessionUser {
  id: string;
  email: string | null;
  username: string;
  isAdmin: boolean;
  coinBalance: number;
}

export async function getSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

export async function setSessionToken(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Secure stays off in dev — the Android emulator hits the page over
    // plain HTTP via http://10.0.2.2:3200, so a Secure flag would drop
    // the cookie. Flip this on in production.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSessionToken(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

// ─── Just-logged-out flag (PR-WEB-LOGOUT-FIX) ─────────────────────
//
// Short-lived HttpOnly cookie set by every logout endpoint. While
// it's present the middleware refuses to silently re-establish a
// session from a `?token=` URL param.
//
// The bug it solves: a logged-out user revisits the site (via a
// hub tile, a bookmark, or even a deep link from the Android shell
// during a forgotten background tab) carrying `?token=<theirJWT>`
// in the URL. The middleware blindly consumed that token and set
// the session cookie again — symptom: "I signed out but next visit
// auto-logs me back in".
//
// 60s TTL is enough to cover the cross-origin logout chain hops +
// any user clicks during the immediate "I just signed out" window.
// It's NOT a JWT revocation list — a determined attacker with a
// leaked URL token still gets in after 60 seconds. For full
// revocation we'd need a Redis revocation list shared with the
// backend; that's a bigger change, intentionally deferred.
export const LOGGED_OUT_COOKIE = "kalki_logged_out";
export const LOGGED_OUT_MAX_AGE_SECONDS = 60;

export async function setLoggedOutFlag(): Promise<void> {
  const jar = await cookies();
  jar.set(LOGGED_OUT_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: LOGGED_OUT_MAX_AGE_SECONDS,
  });
}

// ─── Trusted-device cookie (PR-2FA-2) ─────────────────────────────
// Opaque 32-byte hex token. The backend stores only its sha256 hash
// (see TrustedDeviceService). Long-lived (90 days) and httpOnly, so
// the JS bundle never sees it and it survives across sessions on
// the same browser.
export const TRUSTED_DEVICE_COOKIE = "kalki_trusted_device";
export const TRUSTED_DEVICE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

export async function getTrustedDeviceToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(TRUSTED_DEVICE_COOKIE)?.value ?? null;
}

export async function setTrustedDeviceToken(
  token: string,
  maxAgeSeconds = TRUSTED_DEVICE_MAX_AGE_SECONDS,
): Promise<void> {
  const jar = await cookies();
  jar.set(TRUSTED_DEVICE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

export async function clearTrustedDeviceToken(): Promise<void> {
  const jar = await cookies();
  jar.delete(TRUSTED_DEVICE_COOKIE);
}
