import { AdminUser, setUser } from './auth';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '');

/**
 * Consume a `?token=<backendJWT>` query param on boot. The Kalki hub
 * (auctions app) hands an admin the same JWT it uses to authenticate
 * the user, so the admin console can pick up the session without
 * forcing a second password entry.
 *
 * Cookie-based variant (PR-ADMIN-COOKIE-AUTH): instead of stuffing
 * the bearer into localStorage, we POST to `/auth/admin/sso-accept`
 * with the bearer in the Authorization header. The backend
 * validates, asserts isAdmin, re-issues a full-length session JWT,
 * and sets it as the `kalki_admin_session` httpOnly cookie. The
 * SPA only sees the user object — the JWT never lives in JS-
 * readable storage.
 *
 * Returns true if a token was consumed (regardless of success), so
 * the caller can decide whether to gate rendering on the async
 * exchange.
 */
export async function consumeSsoToken(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token) return false;

  try {
    const res = await fetch(`${API_BASE}/auth/admin/sso-accept`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (res.ok) {
      const data = (await res.json()) as { user: AdminUser };
      if (data.user?.isAdmin) {
        setUser(data.user);
      }
    }
  } catch {
    // Silent — fall through to the regular /login form. The user
    // re-authenticating manually is the worst-case path.
  } finally {
    params.delete('token');
    const qs = params.toString();
    const cleanUrl =
      window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
    window.history.replaceState({}, '', cleanUrl);
  }
  return true;
}
