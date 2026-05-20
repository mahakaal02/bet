/**
 * Admin auth state (PR-ADMIN-COOKIE-AUTH).
 *
 * The session JWT lives in an httpOnly cookie that JS can't read —
 * the browser sends it automatically with `credentials: 'include'`.
 * This module only tracks the *displayed* admin (email, isAdmin, …)
 * for UI render, not the credential itself.
 *
 * Previously, the JWT was in localStorage. That was an XSS hazard:
 * any malicious script (compromised npm dep, mis-served chart asset,
 * etc.) could read the token + impersonate the admin. The httpOnly
 * cookie removes that class of bug.
 *
 * Persistence: sessionStorage (not localStorage) so closing the tab
 * also clears the displayed user, matching the natural session
 * boundary an admin user expects on a privileged surface.
 */

const USER_KEY = 'uniquebid_admin_user';

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  isAdmin: boolean;
  coinBalance: number;
}

export function getUser(): AdminUser | null {
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AdminUser) : null;
  } catch {
    // Corrupt / SecurityError — treat as "not signed in".
    return null;
  }
}

export function setUser(user: AdminUser): void {
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearUser(): void {
  sessionStorage.removeItem(USER_KEY);
}

/**
 * `isAuthed()` is now display-only — the source of truth is the
 * httpOnly cookie, which the backend validates per request. This
 * helper just gates the SPA's route-guard component so we don't
 * flash protected screens between sign-out and redirect.
 */
export function isAuthed(): boolean {
  const user = getUser();
  return Boolean(user?.isAdmin);
}
