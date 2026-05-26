/**
 * Server-side locale + country detection for the Kalki hub login
 * (PR-LOGIN-REDESIGN).
 *
 * Resolves which country code (and therefore which currency, flag,
 * language) the landing page should boot with. Priority order (first
 * match wins):
 *
 *   1. `?locale=XX` query string — explicit override, useful for
 *      QA, language-switch links, and bookmarks.
 *   2. `kalki_locale` cookie — set by the in-page locale switcher
 *      (1-year TTL) so a returning user lands on the same locale
 *      they previously picked.
 *   3. `cf-ipcountry` / `x-vercel-ip-country` request header —
 *      edge-provider geo lookup. Free, accurate, no upstream call.
 *   4. `accept-language` header — derive country from the IETF tag
 *      (e.g. `pt-BR` → BR, `fr-FR` → FR). Mapped to our supported
 *      country list; unsupported tags fall through.
 *   5. Default — `IN` (the launch market).
 *
 * Returns a country code from the SUPPORTED set. Callers should
 * feed it to the same LOCALES map the client component uses so
 * server-rendered HTML matches the post-hydration UI exactly (no
 * locale flash, no SSR/CSR mismatch).
 */

import { cookies, headers } from "next/headers";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE_SECONDS,
} from "./locale-constants";

// Re-export the cookie constants so server callers can still
// import { LOCALE_COOKIE } from "@/lib/locale-detect" — keeps the
// public API of this module the same as before the split.
export { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_SECONDS };

/**
 * Country codes the hub login supports. Keep in sync with the
 * LOCALES map in `app/login/locale-data.ts` — adding a row there
 * + here is the entire "ship a new locale" change set.
 */
export const SUPPORTED_COUNTRIES = [
  "IN",
  "BR",
  "FR",
  "RU",
  "PH",
  "CN",
  "MX",
  "ID",
  "NG",
  "AE",
  "US",
] as const;

export type CountryCode = (typeof SUPPORTED_COUNTRIES)[number];

export const DEFAULT_COUNTRY: CountryCode = "IN";

function isSupported(code: string | null | undefined): code is CountryCode {
  return (
    !!code &&
    (SUPPORTED_COUNTRIES as readonly string[]).includes(code.toUpperCase())
  );
}

/**
 * Map an Accept-Language IETF tag to a supported country code.
 * Region subtags win when present (`pt-BR` → BR); without a region
 * we use the language's primary market (`pt` → BR, `fr` → FR, etc).
 *
 *   parseAcceptLanguage("pt-BR,pt;q=0.9,en;q=0.5") → "BR"
 *   parseAcceptLanguage("fr-CA")                    → "FR"
 *   parseAcceptLanguage("en-US,en;q=0.9")           → "US"
 */
export function parseAcceptLanguage(
  header: string | null | undefined,
): CountryCode | null {
  if (!header) return null;
  const parts = header
    .split(",")
    .map((p) => {
      const [tag, ...params] = p.trim().split(";");
      const qParam = params.find((x) => x.trim().startsWith("q="));
      const q = qParam ? Number(qParam.trim().slice(2)) : 1;
      return { tag: tag.toLowerCase().trim(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((p) => p.tag && p.q > 0)
    .sort((a, b) => b.q - a.q);

  // Language → default market lookup (used when no region subtag).
  const LANG_TO_COUNTRY: Record<string, CountryCode> = {
    en: "US",
    pt: "BR",
    es: "MX",
    fr: "FR",
    ru: "RU",
    zh: "CN",
    id: "ID",
    ar: "AE",
    fil: "PH",
    tl: "PH",
    ha: "NG",
    yo: "NG",
    ig: "NG",
    hi: "IN",
    bn: "IN",
    ta: "IN",
    te: "IN",
    mr: "IN",
    gu: "IN",
    pa: "IN",
  };

  for (const { tag } of parts) {
    // Wildcard / blank → skip.
    if (!tag || tag === "*") continue;

    // Try the region subtag first (e.g. "pt-BR" → "BR").
    const segments = tag.split(/[-_]/);
    const region = segments[1]?.toUpperCase();
    if (region && isSupported(region)) return region as CountryCode;

    // Fall back to the language's default market.
    const lang = segments[0];
    if (LANG_TO_COUNTRY[lang]) return LANG_TO_COUNTRY[lang];
  }
  return null;
}

/**
 * Read all signals and return the resolved country code. Async
 * because Next.js's `headers()` and `cookies()` are now async APIs
 * (App Router) — call from a server component.
 */
export async function detectCountry(
  /** Optional URL search params from the page's `searchParams` prop —
   *  Next.js doesn't pass these to `headers()` so we accept them
   *  explicitly. */
  searchParams?: Record<string, string | string[] | undefined>,
): Promise<CountryCode> {
  // 1. Explicit override via ?locale=XX
  const fromQuery = searchParams?.locale;
  const queryCode = Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
  if (queryCode && isSupported(queryCode)) {
    return queryCode.toUpperCase() as CountryCode;
  }

  // 2. Saved cookie from the locale switcher
  const jar = await cookies();
  const fromCookie = jar.get(LOCALE_COOKIE)?.value;
  if (isSupported(fromCookie)) {
    return fromCookie.toUpperCase() as CountryCode;
  }

  // 3-4. Geo header + Accept-Language
  const hdrs = await headers();
  const geo =
    hdrs.get("x-vercel-ip-country") ??
    hdrs.get("cf-ipcountry") ??
    hdrs.get("x-real-country") ??
    null;
  if (isSupported(geo)) {
    return geo.toUpperCase() as CountryCode;
  }

  const acceptLang = parseAcceptLanguage(hdrs.get("accept-language"));
  if (acceptLang) return acceptLang;

  // 5. Final fallback
  return DEFAULT_COUNTRY;
}
