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
 * Locale resolution order — applied top-to-bottom. The first step
 * that yields a result wins; everything below is skipped.
 *
 *   1. EXPLICIT URL — the path already has `/{locale}/…`. Trust the
 *      user's intent (or the link they followed) and pass through
 *      unchanged. Earliest exit; no cookie writes.
 *   2. PREFERRED_LANGUAGE cookie — manual choice set by the language
 *      switcher. Sticks for a year. Manual choice ALWAYS beats any
 *      heuristic below.
 *   3. ACCEPT-LANGUAGE header — what the user's browser advertises.
 *      Deterministic per-request, so the user's own browser config
 *      gets respected before we guess from network position. A user
 *      in Brazil with Accept-Language=en lands on /en/ — they
 *      explicitly told us they prefer English.
 *   4. GEO-IP — `x-vercel-ip-country` / `cf-ipcountry` / `x-real-country`.
 *      Best-effort guess based on the egress IP. Only fires when
 *      the user hasn't given us any direct signal (no path prefix,
 *      no cookie, no usable Accept-Language).
 *   5. DEFAULT_LOCALE — English. Final fallback.
 *
 * Anti-loop guard: a `kalki_geo_routed` cookie is set the first
 * time we geo-route a visitor. On subsequent non-localized requests
 * we skip the geo step and fall through to DEFAULT_LOCALE. This
 * prevents a Brazilian user who deliberately pastes `/en/wallet`
 * into the URL bar from being perpetually slingshot back to /pt/.
 * (The cookie/AL steps above are stable across requests, so the
 * anti-loop only matters when geo is the deciding factor.)
 *
 * Bots (User-Agent match) NEVER get redirected through the heuristic
 * chain — they go straight to DEFAULT_LOCALE so the crawler index
 * keys off canonical URLs.
 *
 * 302 (Found) not 301 — geo state can change (VPN, travel), Accept-
 * Language can change (browser update), so the redirect must not be
 * cached as permanent by intermediate proxies.
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

  // Step 2 — PREFERRED_LANGUAGE cookie. Manual choice via the
  // language switcher beats every heuristic below; sticks for a
  // year so returning users land on their chosen locale immediately.
  const cookiePref = req.cookies.get(PREFERRED_LOCALE_COOKIE)?.value;
  if (isLocale(cookiePref)) {
    const url = req.nextUrl.clone();
    url.pathname = rest === "/" ? `/${cookiePref}` : `/${cookiePref}${rest}`;
    return NextResponse.redirect(url);
  }

  // Step 3 — ACCEPT-LANGUAGE header. The browser explicitly told us
  // what the user prefers; respect it over the IP-based guess in
  // step 4. This means a French user travelling in Brazil still
  // lands on /fr/ unless they manually pick otherwise.
  //
  // The robust parser handles q-values, region stripping, q=0
  // rejections, and wildcards — see `lib/i18n::parseAcceptLanguage`.
  const acceptPrefs = parseAcceptLanguage(req.headers.get("accept-language"));
  let chosen: string | null = acceptPrefs[0] ?? null;

  // Step 4 — GEO-IP from the edge headers. Only fires when AL gave
  // us nothing usable AND we haven't geo-routed this visitor before
  // (sentinel cookie). The sentinel exists purely to prevent the
  // "stuck on geo locale" loop for users whose AL header doesn't
  // match any supported locale — without it, every non-localized
  // request would re-fire the geo logic and override an intentional
  // /en/ navigation.
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
  // Stamp the geo-routed sentinel after a geo fall-through so we
  // don't re-fire the geo logic on every subsequent non-localized
  // request. Stamping it after the Accept-Language branch isn't
  // necessary (AL is deterministic per-request) but doing it here
  // also doesn't hurt — we always stamp to keep the cookie's TTL
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

// Re-export for clarity — middleware adjacent code that needs the
// cookie names imports them straight from `lib/i18n`.
export {
  PREFERRED_LOCALE_COOKIE,
  PREFERRED_LOCALE_COOKIE_MAX_AGE_SECONDS,
};
