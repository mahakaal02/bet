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
  RTL_LOCALES,
  LOCALE_HEADER,
  isLocale,
  localeForCountry,
  dirForLocale,
  type Locale,
  type Direction,
} from "./config";

export {
  buildLocalizedMetadata,
  openGraphLocale,
  type LocalizedMetadataInput,
} from "./seo";

export {
  formatCategory,
  formatStatus,
  formatOutcome,
  formatResolvedAs,
  formatTradeAction,
  formatTradeActionWithOutcome,
  formatSort,
  formatFilter,
  listCategories,
  listSorts,
  listFilters,
  type MarketCategory,
  type MarketStatus,
  type Outcome,
  type TradeAction,
  type MarketSort,
  type MarketFilter,
} from "./market-format";

export {
  resolveMarketContent,
  marketTranslationInclude,
  type LocalizedMarketContent,
  type MarketWithTranslations,
  type MarketTranslationLike,
} from "./market-content";

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
 * Robust `Accept-Language` parser (RFC 7231 §5.3.5).
 *
 * Returns a preference-ordered list of supported locale codes after:
 *
 *   • Splitting on `,` and trimming each entry.
 *   • Lower-casing tags.
 *   • Parsing `;q=…` weights (default 1.0, clamped to [0, 1]).
 *   • Dropping entries with q=0 (RFC says "not acceptable").
 *   • Tolerating whitespace inside parameters (`fr ; q = 0.9`).
 *   • Region stripping: `fr-CA` and `fr_CA` both match `fr`.
 *   • Wildcard handling: `*` is skipped (no info — falls through to
 *     later resolution steps).
 *   • Deduping: only the first occurrence of a base language wins.
 *   • Stable sort: equal q-values preserve original-header order so
 *     `fr-CA,en-US` (both default q=1) keeps fr first, matching what
 *     the user's browser intended.
 *
 * Examples
 *   "fr-CA,fr;q=0.9,en;q=0.5"  → ["fr", "en"]
 *   "pt-BR,pt;q=0.8,*;q=0.5"   → ["pt"]
 *   "en;q=0,fr;q=0.9"           → ["fr"]           (en explicitly rejected)
 *   "  fr ; q = 0.9 , en "      → ["en", "fr"]     (en defaults to q=1)
 *   "zh-CN,ja"                  → []               (none supported)
 *   ""                          → []
 *   null/undefined              → []
 */
export function parseAcceptLanguage(
  header: string | null | undefined,
): Locale[] {
  if (!header) return [];

  interface Entry {
    tag: string;
    q: number;
    /** Original index in the header — used as the secondary sort key
     *  so equal q-values preserve browser-supplied order. */
    order: number;
  }
  const entries: Entry[] = [];

  header.split(",").forEach((rawPart, idx) => {
    const part = rawPart.trim();
    if (!part) return;

    // Split tag from parameters: "fr-CA; q=0.9" → ["fr-CA", " q=0.9"]
    // — note we trim each side so "fr ; q = 0.9" still parses cleanly.
    const segments = part.split(";").map((s) => s.trim());
    const tag = segments[0].toLowerCase();
    if (!tag) return;

    // Walk parameters looking for q=… (case-insensitive). Anything else
    // is ignored. Default q=1 if absent.
    let q = 1;
    for (let i = 1; i < segments.length; i++) {
      const param = segments[i];
      const eq = param.indexOf("=");
      if (eq < 0) continue;
      const name = param.slice(0, eq).trim().toLowerCase();
      const value = param.slice(eq + 1).trim();
      if (name !== "q") continue;
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        // RFC bounds are [0, 1]; clamp defensively so a misconfigured
        // client sending q=2 doesn't outrank a well-behaved q=1.
        q = Math.max(0, Math.min(1, parsed));
      }
      break;
    }

    // q=0 is the RFC-defined way to say "do not give me this" — skip.
    // Also catches NaN clamped to 0 above.
    if (q <= 0) return;

    entries.push({ tag, q, order: idx });
  });

  // Stable sort: q descending; ties broken by original order.
  entries.sort((a, b) => b.q - a.q || a.order - b.order);

  const out: Locale[] = [];
  const seen = new Set<Locale>();
  for (const entry of entries) {
    // Wildcard `*` carries no signal — let the next-tier resolver
    // (geo / default) decide. Skip and continue.
    if (entry.tag === "*") continue;

    // Strip region/script subtags to the base language. We support
    // 2-letter codes only (`en`, `pt`, `es`, `fr`), so `fr-CA`, `fr_FR`,
    // `pt-BR`, `pt-PT` all collapse to their base. This matches what
    // a Brazilian Portuguese browser wants when "pt-BR" is sent —
    // we serve "pt" and that's fine.
    const baseLang = entry.tag.split(/[-_]/)[0];
    if (isLocale(baseLang) && !seen.has(baseLang)) {
      seen.add(baseLang);
      out.push(baseLang);
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
