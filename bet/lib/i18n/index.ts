/**
 * i18n public API (PR-BET-I18N).
 *
 * Universal — safe to import from server components, route handlers,
 * client components, and middleware (edge runtime). Pure data lookups
 * + tiny string helpers; no I/O, no DB access, no React.
 */

import en, { type Dictionary } from "./translations/en";
import pt from "./translations/pt";
import es from "./translations/es";
import fr from "./translations/fr";
import {
  DEFAULT_LOCALE,
  LOCALES,
  isLocale,
  type Locale,
} from "./config";

export {
  LOCALES,
  DEFAULT_LOCALE,
  LOCALE_DISPLAY,
  COUNTRY_TO_LOCALE,
  PREFERRED_LOCALE_COOKIE,
  PREFERRED_LOCALE_COOKIE_MAX_AGE_SECONDS,
  GEO_ROUTED_COOKIE,
  GEO_ROUTED_COOKIE_MAX_AGE_SECONDS,
  isLocale,
  localeForCountry,
  type Locale,
} from "./config";

/**
 * Dictionary registry. Keyed by locale; English is the only one
 * required to be complete — others are typed `Partial<Dictionary>`
 * and resolved through `walkDeep` below.
 */
const DICTIONARIES: Record<Locale, Partial<Dictionary>> = {
  en,
  pt,
  es,
  fr,
};

/**
 * Translation accessor.
 *
 * Usage:
 *   t('nav.markets', 'pt')               → "Mercados"
 *   t('wallet.minWithdraw', 'en', { amount: 500 })
 *                                        → "Min 500 coins"
 *   t('nav.fakeKey', 'pt')               → 'nav.fakeKey'  (the key
 *                                            itself, surfaced so
 *                                            missing keys are
 *                                            visible during dev)
 *
 * Lookup order:
 *   1. Locale's dictionary (deep path).
 *   2. English fallback for the same path.
 *   3. Raw key (last-ditch — never blows up).
 *
 * Interpolation: `{token}` segments in the value are replaced with
 * the matching key in `vars`. No format-specifier support (no
 * `{n,number,percent}` ICU syntax) — call sites format ahead of
 * time with `Intl.NumberFormat` and pass the string in.
 */
export function t(
  key: string,
  locale: Locale = DEFAULT_LOCALE,
  vars?: Record<string, string | number>,
): string {
  const localised = walkDeep(DICTIONARIES[locale], key);
  const value =
    typeof localised === "string"
      ? localised
      : typeof walkDeep(en, key) === "string"
        ? (walkDeep(en, key) as string)
        : key;
  if (!vars) return value;
  return interpolate(value, vars);
}

/**
 * Dot-path walker. Returns the leaf string or `undefined` if any
 * intermediate segment is missing. Used by `t` above and exposed
 * for code that needs to test for translation presence (e.g.
 * conditional UI affordances).
 */
function walkDeep(dict: unknown, key: string): unknown {
  if (!dict || typeof dict !== "object") return undefined;
  const segments = key.split(".");
  let cursor: unknown = dict;
  for (const seg of segments) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
}

/**
 * Cheap `{var}` interpolation. NOT regex-escaped — vars[key] are
 * assumed to be safe (numbers or trusted strings from server-side
 * data). For untrusted strings (free-text user input), the caller
 * should sanitise before passing in.
 */
function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, name) =>
    name in vars ? String(vars[name]) : m,
  );
}

/* ============================================================
   Path / URL helpers
   ============================================================ */

/**
 * Split a URL pathname into `(locale, rest)`. Returns null for
 * `locale` when no recognised prefix is present.
 *
 *   /pt/wallet         → { locale: 'pt', rest: '/wallet' }
 *   /en                → { locale: 'en', rest: '/' }
 *   /wallet            → { locale: null, rest: '/wallet' }
 *   /                  → { locale: null, rest: '/' }
 *
 * Used by middleware (to decide whether to inject a locale prefix)
 * and by the language switcher (to swap locales while preserving
 * the user's current page).
 */
export function splitLocaleFromPath(pathname: string): {
  locale: Locale | null;
  rest: string;
} {
  // Strip leading slash, take the first segment.
  const trimmed = pathname.replace(/^\/+/, "");
  const idx = trimmed.indexOf("/");
  const head = idx === -1 ? trimmed : trimmed.slice(0, idx);
  if (isLocale(head)) {
    const rest = idx === -1 ? "/" : `/${trimmed.slice(idx + 1)}`;
    return { locale: head, rest };
  }
  return { locale: null, rest: pathname === "" ? "/" : pathname };
}

/**
 * Prepend a locale to a path. Idempotent — passing an already-
 * localized path (e.g. `/pt/wallet`) replaces the existing locale
 * rather than nesting (`/en/pt/wallet`).
 *
 *   localizedPath('/wallet', 'pt')        → '/pt/wallet'
 *   localizedPath('/en/wallet', 'pt')     → '/pt/wallet'
 *   localizedPath('/',  'fr')             → '/fr'
 */
export function localizedPath(pathname: string, locale: Locale): string {
  const { rest } = splitLocaleFromPath(pathname);
  if (rest === "/") return `/${locale}`;
  return `/${locale}${rest}`;
}

/**
 * Build absolute alternate-language URLs for `<link rel="alternate"
 * hreflang>` tags. Returns one entry per supported locale plus
 * `x-default` pointing at the canonical English variant.
 *
 *   alternatesFor('https://example.com', '/wallet')
 *   → {
 *       en: 'https://example.com/en/wallet',
 *       pt: 'https://example.com/pt/wallet',
 *       ...
 *       'x-default': 'https://example.com/en/wallet'
 *     }
 *
 * Pass the result to Next.js `Metadata.alternates.languages` —
 * Next.js emits the link tags for you.
 */
export function alternatesFor(
  origin: string,
  pathnameWithoutLocale: string,
): Record<string, string> {
  const base = origin.replace(/\/$/, "");
  const safePath = pathnameWithoutLocale.startsWith("/")
    ? pathnameWithoutLocale
    : `/${pathnameWithoutLocale}`;
  const out: Record<string, string> = {};
  for (const l of LOCALES) {
    out[l] = safePath === "/" ? `${base}/${l}` : `${base}/${l}${safePath}`;
  }
  out["x-default"] =
    safePath === "/"
      ? `${base}/${DEFAULT_LOCALE}`
      : `${base}/${DEFAULT_LOCALE}${safePath}`;
  return out;
}

/**
 * Parse the `Accept-Language` HTTP header into a preference-ordered
 * list of locale codes. Used as the third-fallback in middleware
 * when both the cookie and the geo header miss.
 *
 *   "fr-CA,fr;q=0.9,en;q=0.5"  →  ['fr', 'en']
 */
export function parseAcceptLanguage(header: string | null | undefined): Locale[] {
  if (!header) return [];
  const parts = header
    .split(",")
    .map((p) => {
      const [tag, ...params] = p.trim().split(";");
      const qParam = params.find((x) => x.startsWith("q="));
      const q = qParam ? Number(qParam.slice(2)) : 1;
      return { tag: tag.toLowerCase().split("-")[0], q: isFinite(q) ? q : 0 };
    })
    .filter((p) => p.tag)
    .sort((a, b) => b.q - a.q);
  const out: Locale[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    if (isLocale(p.tag) && !seen.has(p.tag)) {
      seen.add(p.tag);
      out.push(p.tag);
    }
  }
  return out;
}

/**
 * Common bot detection. Crawlers should land on the requested locale
 * URL directly with no geo-routed redirect — that way Google's index
 * carries the localized URLs the operator intends. Without this,
 * Googlebot crawling from a US IP would always see /en/* and the
 * /pt/* /es/* /fr/* trees might never get indexed.
 *
 * Heuristic — known crawler UA substrings. False negatives are
 * acceptable (unknown crawlers get the normal geo flow, which is
 * still correct content) but false positives risk treating real
 * users as bots.
 */
export function isLikelyBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return (
    ua.includes("bot") ||
    ua.includes("crawl") ||
    ua.includes("spider") ||
    ua.includes("slurp") ||
    ua.includes("baiduspider") ||
    ua.includes("yandex") ||
    ua.includes("duckduckgo") ||
    ua.includes("facebookexternalhit") ||
    ua.includes("whatsapp") ||
    ua.includes("twitterbot") ||
    ua.includes("linkedinbot") ||
    ua.includes("applebot")
  );
}
