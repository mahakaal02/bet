/**
 * Constants shared between the server-side `lib/locale-detect.ts`
 * (which uses `next/headers`) and the client-side `LoginLanding`
 * component (which can't pull in `next/headers`). Keep this file
 * dependency-free so both sides can import it without bundler /
 * server-component boundary issues.
 */

/** Cookie key for the user-chosen locale (persists across visits). */
export const LOCALE_COOKIE = "kalki_locale";

/** 1 year, matches the bet/auctions language preference convention. */
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/**
 * Build the `document.cookie` string that persists the country the user
 * picked on the hub switcher.
 *
 * Cross-subdomain sharing: in prod the hub (kalki-auctions.cloud.
 * podstack.ai) and the wallet (kalki-bet.cloud.podstack.ai) are
 * SEPARATE subdomains, so a host-only cookie set on the hub is never
 * sent to bet — the picked country then silently fails to drive the
 * wallet currency. Set `NEXT_PUBLIC_COOKIE_DOMAIN=.cloud.podstack.ai`
 * (mirrors the backend's `ADMIN_COOKIE_DOMAIN`) so the choice is shared
 * across every *.cloud.podstack.ai app. Unset (local dev: same host,
 * different ports) → host-only cookie, which already works there.
 */
export function localeCookieString(code: string): string {
  const domain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN;
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:";
  return [
    `${LOCALE_COOKIE}=${code}`,
    "path=/",
    `max-age=${LOCALE_COOKIE_MAX_AGE_SECONDS}`,
    "samesite=lax",
    domain ? `domain=${domain}` : "",
    secure ? "secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}
