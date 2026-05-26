/**
 * i18n configuration (PR-AVIATOR-I18N).
 *
 * Single source of truth for which locales the aviator app supports
 * and how to map an incoming visitor's country → preferred locale.
 * Both middleware (edge runtime) and React components import from
 * here; deliberately zero runtime dependencies so the bundle stays
 * tiny.
 *
 * Locale codes follow ISO 639-1. Country codes follow ISO 3166-1
 * alpha-2 (same encoding used by `cf-ipcountry` and
 * `x-vercel-ip-country` request headers).
 */

export const LOCALES = ["en", "pt", "es", "fr"] as const;
export type Locale = (typeof LOCALES)[number];

/** Default fallback when geolocation + cookie + Accept-Language all
 *  fail to resolve a supported locale. Also the locale shown to bots
 *  and to the canonical/x-default hreflang entry. */
export const DEFAULT_LOCALE: Locale = "en";

/**
 * Right-to-left locales. Currently empty (en/pt/es/fr are all LTR)
 * but kept as a typed set so adding `ar` / `he` / `fa` / `ur` in the
 * future is a one-line config change — every component that calls
 * `dirForLocale()` picks up the new direction automatically.
 *
 * Type widening lets us list locales here that aren't yet in `LOCALES`
 * — keeps the dataset honest about which locales are RTL "in
 * principle" so future expansion doesn't forget any.
 */
export const RTL_LOCALES: ReadonlySet<string> = new Set<string>([
  // "ar",  // Arabic
  // "he",  // Hebrew
  // "fa",  // Persian
  // "ur",  // Urdu
]);

export type Direction = "ltr" | "rtl";

/**
 * Resolve text direction for a locale. Used by:
 *   • root layout to emit `<html dir="...">`
 *   • components that need to position direction-sensitive UI
 *     (e.g. chevrons that point "forward" — back vs continue)
 */
export function dirForLocale(locale: Locale | string): Direction {
  return RTL_LOCALES.has(locale) ? "rtl" : "ltr";
}

/**
 * Header name middleware uses to surface the resolved locale to the
 * root layout. The root layout sits ABOVE the `[locale]/` segment so
 * it has no access to `params.locale` — it reads this header instead
 * to emit `<html lang>` and `<html dir>` correctly. Keep in sync
 * with `middleware.ts`.
 */
export const LOCALE_HEADER = "x-aviator-locale";

/**
 * Display name for each locale, used by the language switcher. Native
 * spellings (Português, not "Portuguese") because users recognise
 * those faster, even if they don't currently read the page's language.
 */
export const LOCALE_DISPLAY: Record<Locale, string> = {
  en: "English",
  pt: "Português",
  es: "Español",
  fr: "Français",
};

/**
 * Country → locale mapping for geo-based first-visit detection.
 *
 * Keys are ISO 3166-1 alpha-2 country codes (the same codes
 * Cloudflare/Vercel emit in their geolocation headers). Countries
 * NOT in this map fall through to `DEFAULT_LOCALE` — explicitly
 * mapping every country is impractical and prone to drift.
 *
 * Mapping policy: pick the most-spoken official language IF the
 * platform actually ships a translation for it. We could route
 * Argentina → "es" even though the country is Spanish-speaking,
 * but the user requested explicit per-country control so each row
 * documents intent. Extend the map as the platform adds new
 * languages — never silently degrade an unknown country to a
 * worse fallback than English.
 */
export const COUNTRY_TO_LOCALE: Record<string, Locale> = {
  BR: "pt", // Brazil
  PT: "pt", // Portugal (added for completeness even though not in spec)
  MX: "es", // Mexico
  AR: "es", // Argentina
  ES: "es", // Spain
  CO: "es", // Colombia
  CL: "es", // Chile
  PE: "es", // Peru
  US: "en", // United States
  GB: "en", // United Kingdom
  CA: "en", // Canada (English-default; QC users override manually)
  AU: "en", // Australia
  NZ: "en", // New Zealand
  IN: "en", // India (English is the lingua-franca of the platform's
            //         current target market)
  FR: "fr", // France
  BE: "fr", // Belgium (defaults to French; NL speakers override)
  LU: "fr", // Luxembourg
};

/**
 * Cookie name for the user's manually-chosen locale. Sticks for a
 * year so a returning user lands in their preferred language
 * regardless of which country they're connecting from.
 *
 * NOT HttpOnly — the language switcher needs to read it from
 * client-side JavaScript to render the current selection without
 * a server round-trip. The cookie's value is non-sensitive
 * (just a 2-letter code) so client-readability is safe.
 *
 * SHARED across the kalki app family (bet, auctions, aviator) so a
 * user's manual language choice on any app carries to the others
 * — same cookie, same domain (when deployed to the same root host).
 */
export const PREFERRED_LOCALE_COOKIE = "preferred_language";
export const PREFERRED_LOCALE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/**
 * Sentinel cookie used to flag "user has been served the geo-routed
 * locale at least once" so we don't re-route on every subsequent
 * visit if they happen NOT to have set a preference. Without this
 * sentinel, a Brazilian user who deliberately navigates to /en/
 * but never clicks the language switcher would be re-routed to
 * /pt/ on every page load — terrible UX.
 *
 * Value is always "1"; presence-only semantic.
 */
export const GEO_ROUTED_COOKIE = "kalki_geo_routed";
export const GEO_ROUTED_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30d

/**
 * Type guard. The middleware needs to validate untrusted strings
 * (URL segments, cookie values) without an extra import.
 */
export function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

/**
 * Resolve a country code (or undefined) to a supported locale. Pure
 * function so the middleware + any server-component path uses the
 * same logic.
 */
export function localeForCountry(country: string | null | undefined): Locale {
  if (!country) return DEFAULT_LOCALE;
  const mapped = COUNTRY_TO_LOCALE[country.toUpperCase()];
  return mapped ?? DEFAULT_LOCALE;
}
