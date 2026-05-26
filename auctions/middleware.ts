import { NextResponse, type NextRequest } from "next/server";
import {
  LOGGED_OUT_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/session";
import {
  DEFAULT_LOCALE,
  GEO_ROUTED_COOKIE,
  GEO_ROUTED_COOKIE_MAX_AGE_SECONDS,
  LOCALE_HEADER,
  PREFERRED_LOCALE_COOKIE,
  PREFERRED_LOCALE_COOKIE_MAX_AGE_SECONDS,
  isLikelyBot,
  isLocale,
  localeForCountry,
  parseAcceptLanguage,
  splitLocaleFromPath,
} from "@/lib/i18n";

/**
 * Auctions middleware (edge runtime) — two responsibilities:
 *
 *   1. SSO bridge (existing): `?token=…` → set the auctions session
 *      cookie + strip the param from the URL. Mirrors how the Android
 *      shell and Kalki Hub hand off the user's JWT to this webview.
 *
 *   2. i18n routing (PR-AUCTIONS-I18N): inject the appropriate locale
 *      segment into every user-facing URL so the SEO tree is
 *      `/{en|pt|es|fr}/...`.
 *
 * The SSO bridge runs FIRST — if there's a `?token=` query param we
 * stamp the cookie + redirect to the clean URL before any i18n logic
 * fires. That keeps two unrelated concerns from interleaving and
 * matches the order of operations that existed before i18n landed.
 *
 * Locale resolution order — applied top-to-bottom after the SSO
 * bridge. The first step that yields a result wins; everything below
 * is skipped.
 *
 *   1. EXPLICIT URL — the path already has `/{locale}/…`. Trust the
 *      user's intent (or the link they followed) and pass through
 *      unchanged. Earliest exit; no cookie writes.
 *   2. PREFERRED_LANGUAGE cookie — manual choice set by the language
 *      switcher. Sticks for a year. Manual choice ALWAYS beats any
 *      heuristic below.
 *   3. ACCEPT-LANGUAGE header — what the user's browser advertises.
 *      Deterministic per-request, so the user's own browser config
 *      gets respected before we guess from network position.
 *   4. GEO-IP — `x-vercel-ip-country` / `cf-ipcountry` / `x-real-country`.
 *      Best-effort guess based on the egress IP. Only fires when
 *      the user hasn't given us any direct signal.
 *   5. DEFAULT_LOCALE — English. Final fallback.
 *
 * Anti-loop guard: a `kalki_geo_routed` cookie is set the first time
 * we geo-route a visitor. On subsequent non-localized requests we
 * skip the geo step and fall through to DEFAULT_LOCALE. This prevents
 * a Brazilian user who deliberately pastes `/en/auctions` into the URL
 * bar from being perpetually slingshot back to /pt/.
 *
 * Bots (User-Agent match) NEVER get redirected through the heuristic
 * chain — they go straight to DEFAULT_LOCALE so the crawler index
 * keys off canonical URLs.
 *
 * 302 (Found) not 301 — geo state can change (VPN, travel), Accept-
 * Language can change (browser update), so the redirect must not be
 * cached as permanent by intermediate proxies.
 */
export function middleware(req: NextRequest) {
  /* ----- existing SSO bridge ----- */
  const token = req.nextUrl.searchParams.get("token");
  if (token) {
    const justLoggedOut = req.cookies.get(LOGGED_OUT_COOKIE)?.value === "1";

    const url = req.nextUrl.clone();
    url.searchParams.delete("token");

    if (justLoggedOut) {
      // Strip the token from the URL but DO NOT set a session cookie.
      // The user explicitly logged out within the last 60s — they
      // shouldn't be silently re-signed-in by a stale URL param.
      return NextResponse.redirect(url);
    }

    const res = NextResponse.redirect(url);
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return res;
  }

  /* ----- i18n routing (PR-AUCTIONS-I18N) ----- */
  const { locale: pathLocale, rest } = splitLocaleFromPath(req.nextUrl.pathname);

  if (pathLocale) {
    // URL already has a locale prefix. Trust it as the user's intent
    // and let it through unchanged — but surface the locale to the
    // root layout via a request header so `<html lang>` and
    // `<html dir>` render correctly. (The root layout sits above
    // [locale]/ so it can't read `params.locale` directly.)
    const headers = new Headers(req.headers);
    headers.set(LOCALE_HEADER, pathLocale);
    return NextResponse.next({ request: { headers } });
  }

  // Non-localized prefixes — these stay at the root and never get
  // bounced into a [locale]/ tree. /share/* is rendered for bots and
  // unfurl crawlers (no locale needed); the global matcher already
  // excludes /api and Next.js internals, but enumerating /share here
  // keeps the policy explicit even if matcher rules change.
  const NON_LOCALIZED_PREFIXES = ["/share"];
  if (NON_LOCALIZED_PREFIXES.some((p) => rest === p || rest.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  // Non-localized path — figure out where to send the user.
  const userAgent = req.headers.get("user-agent");
  if (isLikelyBot(userAgent)) {
    // Bot — redirect to the default locale unconditionally so the
    // crawler's index keys off the canonical localized URL, not the
    // bare path. 302 because the bare path may host different
    // content in the future (e.g. a redirect to a locale picker).
    const url = req.nextUrl.clone();
    url.pathname = rest === "/" ? `/${DEFAULT_LOCALE}` : `/${DEFAULT_LOCALE}${rest}`;
    return NextResponse.redirect(url);
  }

  // Step 2 — PREFERRED_LANGUAGE cookie. Manual choice via the
  // language switcher beats every heuristic below.
  const cookiePref = req.cookies.get(PREFERRED_LOCALE_COOKIE)?.value;
  if (isLocale(cookiePref)) {
    const url = req.nextUrl.clone();
    url.pathname = rest === "/" ? `/${cookiePref}` : `/${cookiePref}${rest}`;
    return NextResponse.redirect(url);
  }

  // Step 3 — ACCEPT-LANGUAGE header. The browser explicitly told us
  // what the user prefers; respect it over the IP-based guess.
  // Robust q-value handling lives in `lib/i18n::parseAcceptLanguage`.
  const acceptPrefs = parseAcceptLanguage(req.headers.get("accept-language"));
  let chosen: string | null = acceptPrefs[0] ?? null;

  // Step 4 — GEO-IP from the edge headers. Only fires when AL gave
  // us nothing usable AND we haven't geo-routed this visitor before
  // (sentinel cookie).
  const alreadyRouted = req.cookies.get(GEO_ROUTED_COOKIE)?.value === "1";
  let geoFired = false;
  if (!chosen && !alreadyRouted) {
    const country =
      req.headers.get("x-vercel-ip-country") ??
      req.headers.get("cf-ipcountry") ??
      req.headers.get("x-real-country") ??
      null;
    if (country) {
      const geoLocale = localeForCountry(country);
      if (geoLocale !== DEFAULT_LOCALE) {
        chosen = geoLocale;
        geoFired = true;
      }
    }
  }

  // Step 5 — DEFAULT_LOCALE fallback.
  if (!chosen || !isLocale(chosen)) {
    chosen = DEFAULT_LOCALE;
  }

  const url = req.nextUrl.clone();
  url.pathname = rest === "/" ? `/${chosen}` : `/${chosen}${rest}`;
  const res = NextResponse.redirect(url);
  // Stamp the geo-routed sentinel so we don't re-fire the geo logic
  // on every subsequent non-localized request. Keeps the cookie TTL
  // fresh once we've routed a user at least once.
  if (geoFired || !alreadyRouted) {
    res.cookies.set(GEO_ROUTED_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: GEO_ROUTED_COOKIE_MAX_AGE_SECONDS,
    });
  }
  return res;
}

export const config = {
  // Skip API + Next.js framework + static asset routes. Anything
  // else (user-facing pages) flows through the i18n logic above.
  matcher: [
    "/((?!_next|api|favicon\\.ico|sitemap\\.xml|robots\\.txt|kalki-logo\\.png|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|js|css|woff2?)).*)",
  ],
};

// Re-export for clarity — adjacent code that needs the cookie names
// imports them straight from `lib/i18n`.
export {
  PREFERRED_LOCALE_COOKIE,
  PREFERRED_LOCALE_COOKIE_MAX_AGE_SECONDS,
};
