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
