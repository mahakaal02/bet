/**
 * Cross-origin URL helpers for the Kalki hub (PR-SINGLE-LOGIN).
 *
 * The hub IS the auctions app (`auctions/app/page.tsx`) — it
 * lists the three games (Auctions, Aviator, Bet) and owns the
 * single sign-in surface (`/login`). Bet, Aviator and other Kalki
 * properties have NO local login UI any more; they redirect
 * un-authenticated users back to the hub login, where the user
 * picks which game to enter.
 *
 * Resolves the hub origin at call time so the same bundle works
 * across desktop browsers, the Android emulator (`10.0.2.2`),
 * LAN deployments and production. The resolution rules:
 *
 *   1. `NEXT_PUBLIC_AUCTIONS_URL` from the build env, when set.
 *   2. Match the current window's hostname on port 3200 (LAN /
 *      Android-emulator deployments where the same host serves
 *      both apps on different ports).
 *   3. `http://localhost:3200` (local dev fallback).
 *
 * Server-component callers won't have `window`; they fall through
 * to the env var or localhost. This is fine because server-side
 * redirects use the URL as a Location header value, which the
 * browser then resolves — and by the time the browser hits this
 * code we're at step 2.
 */

const FALLBACK_HUB = "http://localhost:3200";
const FALLBACK_HUB_PORT = "3200";

/**
 * Absolute origin of the Kalki hub. Always returned without a
 * trailing slash so call sites can do `${hubBaseUrl()}/login`
 * without worrying about double slashes.
 */
export function hubBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_AUCTIONS_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      return `http://${host}:${FALLBACK_HUB_PORT}`;
    }
  }
  return FALLBACK_HUB;
}

/**
 * URL of the single sign-in page on the hub.
 *
 *   hubLoginUrl()
 *     → "https://kalki.exchange/login"
 *
 *   hubLoginUrl({ next: "https://exchange.kalki/markets/super-bowl" })
 *     → "https://kalki.exchange/login?next=…"   ← URL-encoded
 *
 * NOTE: the auctions login page only follows `next` when it's a
 * SAME-ORIGIN path (security — it doesn't want to redirect users
 * to attacker-controlled domains). For cross-origin destinations
 * (e.g. "back to a deep link in the bet app") we omit `next` and
 * let the post-login flow land the user on the hub, from which
 * they pick the Exchange tile and SSO into bet via `?token=…`.
 *
 * For analytics: if the inbound URL carried UTM / click-ID params
 * those survive the redirect to the hub via the cross-origin
 * `Referer` header; the hub login page records its own attribution
 * separately.
 */
export interface HubLoginOptions {
  /** Optional same-origin path (relative to the hub) to redirect
   *  the user to after they sign in. Defaults to "/" (the hub
   *  itself), so a freshly-signed-in user lands on the three-tile
   *  game picker. Cross-origin URLs are silently dropped — see
   *  the function block comment for why. */
  next?: string;
}

export function hubLoginUrl(options: HubLoginOptions = {}): string {
  const base = hubBaseUrl();
  // Default to landing on the hub (which has the three game tiles).
  // The user picks Exchange from there and re-enters bet via SSO.
  const rawNext = options.next ?? "/";
  // Drop anything that doesn't start with "/" — auctions ignores
  // cross-origin `next` values anyway, and shipping a junk param
  // just bloats the URL.
  const next = rawNext.startsWith("/") ? rawNext : "/";
  if (next === "/") return `${base}/login`;
  return `${base}/login?next=${encodeURIComponent(next)}`;
}

/**
 * Convenience: the hub URL itself (the game picker), no login
 * step assumed. Useful for "back to hub" CTAs that fire after a
 * user is already signed in.
 */
export function hubHomeUrl(): string {
  return `${hubBaseUrl()}/`;
}
