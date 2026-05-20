/**
 * Minimal cookie helpers (PR-ADMIN-COOKIE-AUTH).
 *
 * Zero-dep, by design — `cookie-parser` would only be used in two
 * places (read on the JWT strategy, set on the admin login route)
 * and brings ~1 MB of transitive deps for ~30 lines of work. Same
 * call as the inline SigV4 / inline INSTREAM patterns elsewhere.
 *
 * What `cookie.ts` does:
 *
 *   - `parseCookieHeader(raw)` — turn `Cookie: foo=bar; baz=qux`
 *     into `{ foo: 'bar', baz: 'qux' }`. Tolerates whitespace + dup
 *     keys (last write wins, matching browser semantics).
 *
 *   - `ADMIN_COOKIE_NAME` — the cookie key the admin SPA's session
 *     JWT lives under. Stable string so log filters / e2e tests
 *     can pin on it.
 *
 *   - `serializeAdminCookie(token, { secure, domain, maxAgeSeconds })`
 *     — build the `Set-Cookie` value. Used by `res.setHeader()` so
 *     we don't need cookie-parser on the response side either.
 *
 * Why not Express's `res.cookie()`: it exists, but reaches into the
 * platform adapter in a way that the WS-adapter Nest bootstrap
 * doesn't preserve cleanly across mocked request contexts in tests.
 * Building the string ourselves is ~12 lines + lets us assert the
 * exact header in unit tests.
 */

export const ADMIN_COOKIE_NAME = 'kalki_admin_session';

/**
 * Strip leading/trailing whitespace and split on the first '=' so
 * cookie values containing '=' (e.g. base64) survive unchanged.
 */
export function parseCookieHeader(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) {
      // Cookie with no value — uncommon but valid; store as empty.
      out[trimmed] = '';
      continue;
    }
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export interface AdminCookieOptions {
  /** Set `Secure` (HTTPS-only). Off in local dev; on in any non-dev env. */
  secure: boolean;
  /**
   * Optional `Domain` attribute. Set to `.cloud.podstack.ai` so the
   * cookie flows between admin + backend subdomains. Omit (leave
   * undefined) to bind the cookie to the API host only — strictest,
   * works when admin SPA is reverse-proxied through the API host.
   */
  domain?: string;
  /** TTL in seconds. Defaults to 12h matching the JWT expiry. */
  maxAgeSeconds?: number;
}

/**
 * Build the `Set-Cookie` value for the admin session.
 *
 * Flags rationale:
 *   - HttpOnly: blocks `document.cookie` reads (defence in depth
 *     against XSS exfiltration of the session).
 *   - Secure: blocks cleartext transport. Disabled in dev so Vite's
 *     http://localhost:5173 → http://localhost:4000 path keeps
 *     working.
 *   - SameSite=Lax: cookie sent on same-site requests (matches
 *     eTLD+1; admin.cloud.podstack.ai → backend.cloud.podstack.ai
 *     is same-site) and on top-level navigation, NOT on cross-site
 *     POSTs — kills the simple CSRF vector without needing tokens.
 *   - Path=/: scoped to the whole API, since admin endpoints span
 *     multiple controllers.
 */
export function serializeAdminCookie(
  token: string,
  opts: AdminCookieOptions,
): string {
  const parts: string[] = [];
  parts.push(`${ADMIN_COOKIE_NAME}=${token}`);
  parts.push('Path=/');
  parts.push('HttpOnly');
  parts.push('SameSite=Lax');
  if (opts.secure) parts.push('Secure');
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  const maxAge = opts.maxAgeSeconds ?? 12 * 60 * 60; // 12h
  parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

/**
 * Build a `Set-Cookie` value that clears the admin session. Setting
 * an empty value + `Max-Age=0` is the cross-browser-stable pattern
 * (Expires alone is sometimes ignored when the value is non-empty).
 */
export function serializeAdminCookieClear(opts: AdminCookieOptions): string {
  const parts: string[] = [];
  parts.push(`${ADMIN_COOKIE_NAME}=`);
  parts.push('Path=/');
  parts.push('HttpOnly');
  parts.push('SameSite=Lax');
  if (opts.secure) parts.push('Secure');
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  parts.push('Max-Age=0');
  return parts.join('; ');
}
