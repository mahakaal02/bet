'use client';

const TOKEN_KEY = 'uniquebid_aviator_token';
const USER_KEY = 'uniquebid_aviator_user';

// PR-WEB-LOGOUT-FIX — timestamp of the most recent explicit
// `clearAuth()`. `wasJustLoggedOut()` returns true for 60s after a
// logout, and the page-level AuthGate (see app/page.tsx) refuses to
// consume a `?token=` URL param while that flag is hot. Stops the
// "I logged out, then a stale hub tile / bookmark with `?token=…`
// silently logged me back in" failure mode.
//
// The flag lives in localStorage (not sessionStorage) so it survives
// a refresh + a same-tab navigation away and back. Auto-cleared by
// `wasJustLoggedOut()` after the TTL elapses, so it doesn't
// permanently block fresh logins (the user can sign in again
// normally after the 60s window — via the auctions /login page).
const LOGGED_OUT_AT_KEY = 'uniquebid_aviator_logged_out_at';
const LOGGED_OUT_TTL_MS = 60 * 1000;

import type { AuthUser } from './types';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function getUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as AuthUser) : null;
}

export function setUser(u: AuthUser) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USER_KEY, JSON.stringify(u));
}

export function clearAuth() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  // Stamp the logout time so the page-level AuthGate can refuse a
  // stale `?token=` URL param for the next ~60s.
  try {
    localStorage.setItem(LOGGED_OUT_AT_KEY, String(Date.now()));
  } catch {
    /* localStorage quota / disabled — non-fatal */
  }
}

/**
 * Was there an explicit `clearAuth()` call within the last
 * LOGGED_OUT_TTL_MS? Used by the AuthGate to suppress URL-token auto-
 * sign-in immediately after logout. Auto-prunes the stored
 * timestamp once it's stale so the flag doesn't permanently block
 * legitimate sign-ins.
 */
export function wasJustLoggedOut(): boolean {
  if (typeof window === 'undefined') return false;
  const raw = localStorage.getItem(LOGGED_OUT_AT_KEY);
  if (!raw) return false;
  const at = Number(raw);
  if (!Number.isFinite(at)) {
    localStorage.removeItem(LOGGED_OUT_AT_KEY);
    return false;
  }
  if (Date.now() - at > LOGGED_OUT_TTL_MS) {
    localStorage.removeItem(LOGGED_OUT_AT_KEY);
    return false;
  }
  return true;
}
