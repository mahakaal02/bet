import { NextResponse, type NextRequest } from "next/server";
import {
  DEFAULT_LOCALE,
  GEO_ROUTED_COOKIE,
  GEO_ROUTED_COOKIE_MAX_AGE_SECONDS,
  PREFERRED_LOCALE_COOKIE,
  PREFERRED_LOCALE_COOKIE_MAX_AGE_SECONDS,
  isLikelyBot,
  isLocale,
  localeForCountry,
  parseAcceptLanguage,
  splitLocaleFromPath,
} from "@/lib/i18n";

/**
 * Bet middleware (edge runtime) — two responsibilities:
 *
 *   1. SSO bridge (existing): `?token=…` → /api/auth/sso path.
 *   2. i18n routing (PR-BET-I18N): inject the appropriate locale
 *      segment into every user-facing URL so the SEO tree is
 *      `/{en|pt|es|fr}/...`.
 *
 * Locale resolution order (only applied when the path doesn't
 * already carry a locale prefix):
 *
 *   1. Manual preference cookie (`preferred_language`). Sticks
 *      for a year — manual choice ALWAYS wins.
 *   2. Edge geolocation header (`x-vercel-ip-country`, `cf-ipcountry`,
 *      `x-real-country`). First-visit auto-routing.
 *   3. `Accept-Language` HTTP header (third-fallback so a French
 *      user on a US VPN still lands on /fr/ if their browser
 *      advertises French).
 *   4. `DEFAULT_LOCALE` (English).
 *
 * Anti-loop guard: a `kalki_geo_routed` cookie is set the first
 * time we geo-route a visitor. On subsequent visits where the path
 * is non-localized, we skip the auto-route and default to the
 * cookie or English. That way a Brazilian user who deliberately
 * pastes /en/ into the URL bar isn't perpetually slingshot back to
 * /pt/ — they get what they asked for.
 *
 * Bots (User-Agent match) NEVER get redirected. Crawler sees the
 * exact URL it requested; no surprise 302s skew the index.
 *
 * 302 (Found) not 301 — geo state can change (VPN, travel), so the
 * redirect must not be cached as permanent by intermediate proxies.
 */
export const config = {
  // Match every path EXCEPT:
  //   - /_next/* (Next.js internals + static assets)
  //   - /api/*   (HTTP API routes, not user-facing)
  //   - /admin/* (operator surface, English-only by policy)
  //   - file extensions (favicon.ico, sitemap.xml, robots.txt,
  //                       opengraph-image.png, etc.)
  matcher: [
    "/((?!_next|api|admin|favicon\\.ico|sitemap\\.xml|robots\\.txt|kalki-logo\\.png|logo\\.png|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|js|css|woff2?)).*)",
  ],
};

export function middleware(req: NextRequest) {
  /* ----- existing SSO bridge ----- */
  const token = req.nextUrl.searchParams.get("token");
  if (token && !req.nextUrl.pathname.startsWith("/api/auth/sso")) {
    // PR-WEB-LOGOUT-FIX — refuse to re-establish a NextAuth session
    // from a `?token=` URL param if the user just signed out.
    const justLoggedOut = req.cookies.get("kalki_logged_out")?.value === "1";
    if (justLoggedOut) {
      const cleanUrl = req.nextUrl.clone();
      cleanUrl.searchParams.delete("token");
      return NextResponse.redirect(cleanUrl);
    }
    const cleanUrl = req.nextUrl.clone();
    cleanUrl.searchParams.delete("token");
    const sso = req.nextUrl.clone();
    sso.pathname = "/api/auth/sso";
    sso.searchParams.set("next", cleanUrl.pathname + cleanUrl.search);
    return NextResponse.redirect(sso);
  }

  /* ----- i18n routing (PR-BET-I18N) ----- */
  const { locale: pathLocale, rest } = splitLocaleFromPath(req.nextUrl.pathname);

  if (pathLocale) {
    // URL already has a locale prefix. Trust it as the user's intent
    // and let it through unchanged. No cookie writes here — that's
    // owned by the language switcher (explicit user action) so a
    // user landing on /en/ via a shared link doesn't accidentally
    // overwrite their /pt/ preference.
    return NextResponse.next();
  }

  // PR-BET-I18N — migration completed. Every user-facing route now
  // lives under `app/[locale]/*`. We use a prefix-match guard
  // instead of an exact-set so deep dynamic routes (e.g.
  // `/markets/super-bowl-winner`) also get localized — without
  // having to enumerate every market slug in this file.
  //
  // The exclusion list `NON_LOCALIZED_PREFIXES` enumerates paths
  // that intentionally stay non-localized (operator surface, OG
  // image generators, etc.). The middleware-level `matcher` config
  // already filters /api, /admin, /_next, etc.; this list catches
  // anything else that should bypass i18n routing.
  const NON_LOCALIZED_PREFIXES = ["/share"]; // server-side share previews
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

  // Step 1 — manual preference cookie (most authoritative for
  // returning humans).
  const cookiePref = req.cookies.get(PREFERRED_LOCALE_COOKIE)?.value;
  if (isLocale(cookiePref)) {
    const url = req.nextUrl.clone();
    url.pathname = rest === "/" ? `/${cookiePref}` : `/${cookiePref}${rest}`;
    return NextResponse.redirect(url);
  }

  // Step 2 — already-geo-routed sentinel. If we've routed this
  // visitor before AND they haven't set a manual preference (would
  // have hit step 1), they've been navigating without picking — send
  // them to the default rather than re-running geo logic on every
  // page load.
  const alreadyRouted = req.cookies.get(GEO_ROUTED_COOKIE)?.value === "1";
  let chosen = DEFAULT_LOCALE;
  if (!alreadyRouted) {
    // First visit. Try geo, then Accept-Language, then default.
    const country =
      req.headers.get("x-vercel-ip-country") ??
      req.headers.get("cf-ipcountry") ??
      req.headers.get("x-real-country") ??
      null;
    const geoLocale = country ? localeForCountry(country) : DEFAULT_LOCALE;
    if (geoLocale !== DEFAULT_LOCALE) {
      chosen = geoLocale;
    } else {
      const acceptPrefs = parseAcceptLanguage(
        req.headers.get("accept-language"),
      );
      if (acceptPrefs.length > 0) chosen = acceptPrefs[0];
    }
  }

  const url = req.nextUrl.clone();
  url.pathname = rest === "/" ? `/${chosen}` : `/${chosen}${rest}`;
  const res = NextResponse.redirect(url);
  // Stamp the geo-routed sentinel so we don't re-run the geo
  // resolution on every subsequent non-localized request. Also
  // refresh the TTL if the cookie already exists.
  res.cookies.set(GEO_ROUTED_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GEO_ROUTED_COOKIE_MAX_AGE_SECONDS,
  });
  return res;
}

// Re-export for clarity — middleware adjacent code that needs the
// cookie names imports them straight from `lib/i18n`.
export {
  PREFERRED_LOCALE_COOKIE,
  PREFERRED_LOCALE_COOKIE_MAX_AGE_SECONDS,
};
