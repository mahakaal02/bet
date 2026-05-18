import { AdminUser, setToken, setUser } from './auth';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '');

/**
 * Consume a `?token=<backendJWT>` query param on boot. The Kalki hub
 * (auctions app) hands an admin the same JWT it uses to authenticate
 * the user, so the admin console can pick up the session without
 * forcing a second password entry. We trade the bearer for the user
 * record via `/auth/me`, persist both, then strip the token from the
 * URL so a reload/bookmark doesn't replay it.
 *
 * Returns true if a token was consumed (regardless of success), so the
 * caller can decide whether to gate rendering on the async exchange.
 */
export async function consumeSsoToken(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token) return false;

  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const user = (await res.json()) as AdminUser;
      if (user.isAdmin) {
        setToken(token);
        setUser(user);
      }
    }
  } catch {
    // Silent — fall through to the regular /login form.
  } finally {
    params.delete('token');
    const qs = params.toString();
    const cleanUrl =
      window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
    window.history.replaceState({}, '', cleanUrl);
  }
  return true;
}
