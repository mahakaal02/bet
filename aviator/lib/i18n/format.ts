/**
 * Locale-aware formatting (PR-AVIATOR-I18N).
 *
 * One place to format numbers, currency, percentages, dates, and
 * relative time so the entire app renders consistently per the
 * active locale. Wraps the platform `Intl.*` APIs, which:
 *
 *   • Are built into V8 / SpiderMonkey / JSC — zero bundle cost.
 *   • Produce locale-correct separators (1,234.56 vs 1.234,56),
 *     digit groupings, currency symbols, and pluralised relative
 *     time ("il y a 2 jours" / "há 2 dias" / "hace 2 días").
 *   • SSR-safe — `Intl` works identically in Node and the browser,
 *     so server-rendered formatting matches client hydration.
 *
 * Why not just call `Intl.NumberFormat` inline at every render?
 *   1. Each `Intl.NumberFormat` constructor allocates a fresh
 *      formatter — expensive in hot lists (markets grid renders 50+
 *      times per row * cell). The module caches one instance per
 *      (locale, options) tuple.
 *   2. Centralised helpers make swapping defaults (locale, currency,
 *      digit style) a one-line change instead of grepping the codebase.
 *   3. Consistent "—" rendering for non-finite inputs — every chart /
 *      table / badge handles missing data the same way.
 *
 * Module is server-AND-client safe. No React imports here; the
 * React hook lives in `./format-client.ts` to keep this file
 * universal.
 */

import type { Locale } from "./config";

/**
 * Convert a Locale (short code) to the IETF tag we hand to
 * `Intl.*`. Without this, `Intl` falls back to the bare language
 * which uses generic separators rather than the regional ones
 * users expect (pt-BR comma vs pt-PT space).
 */
const IETF_TAG: Record<Locale, string> = {
  en: "en-US",
  pt: "pt-BR",
  es: "es-ES",
  fr: "fr-FR",
};

function ietf(locale: Locale): string {
  return IETF_TAG[locale] ?? locale;
}

/* ============================================================
   Cache layer — one formatter per (locale, options-key)
   ============================================================ */

const numberFormatterCache = new Map<string, Intl.NumberFormat>();
const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();
const relativeFormatterCache = new Map<string, Intl.RelativeTimeFormat>();

function getNumberFormatter(
  locale: Locale,
  options: Intl.NumberFormatOptions = {},
): Intl.NumberFormat {
  const key = `${locale} ${JSON.stringify(options)}`;
  let fmt = numberFormatterCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(ietf(locale), options);
    numberFormatterCache.set(key, fmt);
  }
  return fmt;
}

function getDateFormatter(
  locale: Locale,
  options: Intl.DateTimeFormatOptions = {},
): Intl.DateTimeFormat {
  const key = `${locale} ${JSON.stringify(options)}`;
  let fmt = dateFormatterCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(ietf(locale), options);
    dateFormatterCache.set(key, fmt);
  }
  return fmt;
}

function getRelativeFormatter(
  locale: Locale,
  options: Intl.RelativeTimeFormatOptions = {},
): Intl.RelativeTimeFormat {
  const key = `${locale} ${JSON.stringify(options)}`;
  let fmt = relativeFormatterCache.get(key);
  if (!fmt) {
    fmt = new Intl.RelativeTimeFormat(ietf(locale), options);
    relativeFormatterCache.set(key, fmt);
  }
  return fmt;
}

/* ============================================================
   Numbers
   ============================================================ */

/**
 * Format a number with locale-aware separators.
 *
 *   formatNumber(1234567.89, "en") → "1,234,567.89"
 *   formatNumber(1234567.89, "pt") → "1.234.567,89"
 *   formatNumber(1234567.89, "fr") → "1 234 567,89"
 *
 * `bigint` is accepted because some on-chain quantities exceed
 * Number.MAX_SAFE_INTEGER and we don't want lossy coercion at
 * format time.
 */
export function formatNumber(
  value: number | bigint,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  if (typeof value === "number" && !Number.isFinite(value)) return "—";
  return getNumberFormatter(locale, options).format(value);
}

/**
 * Locale-aware integer / fractional coin count. Drops decimals by
 * default — kalki coins are integer at the wallet layer (per the
 * 1₹=1 rule); fractional results show up only in mid-trade share
 * counts. Caller can override `maximumFractionDigits` to render
 * those.
 */
export function formatCoins(
  value: number | bigint,
  locale: Locale,
): string {
  return formatNumber(value, locale, {
    maximumFractionDigits: 0,
  });
}

/**
 * Compact-notation number: "1.2K", "3.4M", "1.2 mi" (pt), "1,2 M"
 * (fr). Use for dense stat tiles where horizontal space is tight.
 */
export function formatCompact(
  value: number | bigint,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  return formatNumber(value, locale, {
    notation: "compact",
    maximumFractionDigits: 1,
    ...options,
  });
}

/**
 * Percentage from a 0..1 ratio (e.g. 0.55 → "55%").
 * digits defaults to 0 — UI rarely wants fractional percentage
 * points; bump for places like analytics where 12.7% matters.
 */
export function formatPercent(
  ratio: number,
  locale: Locale,
  digits: number = 0,
): string {
  if (!Number.isFinite(ratio)) return "—";
  return formatNumber(ratio, locale, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * Currency with the right symbol + grouping for the locale.
 *
 *   formatCurrency(1234.5, "en", "INR") → "₹1,234.50"
 *   formatCurrency(1234.5, "fr", "EUR") → "1 234,50 €"
 *
 * Defaults to INR because that's the platform's settlement
 * currency. Override per call when displaying USD-denominated
 * exchange rates etc.
 */
export function formatCurrency(
  value: number,
  locale: Locale,
  currency: string = "INR",
): string {
  if (!Number.isFinite(value)) return "—";
  return formatNumber(value, locale, {
    style: "currency",
    currency,
    currencyDisplay: "symbol",
  });
}

/**
 * Prediction-market price (0..1 quote). These are intentionally
 * NOT formatted with currency / percent — markets quote in decimal
 * (0.55) the way Polymarket / Kalshi do. Locale-aware only insofar
 * as the decimal separator changes: "0.55" (en) vs "0,55" (pt/fr).
 */
export function formatPrice(
  price: number,
  locale: Locale,
  digits: number = 2,
): string {
  if (!Number.isFinite(price)) return "—";
  return formatNumber(price, locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/* ============================================================
   Dates
   ============================================================ */

/**
 * Short-style date: "May 26, 2026" (en), "26 de mai. de 2026"
 * (pt), "26 may 2026" (es), "26 mai 2026" (fr).
 */
export function formatDate(
  date: Date | string,
  locale: Locale,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  return getDateFormatter(locale, {
    dateStyle: "medium",
    ...options,
  }).format(d);
}

/** Date + time, e.g. "May 26, 2026, 5:23 PM". */
export function formatDateTime(
  date: Date | string,
  locale: Locale,
  options?: Intl.DateTimeFormatOptions,
): string {
  return formatDate(date, locale, {
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  });
}

/* ============================================================
   Relative time
   ============================================================ */

const RELATIVE_THRESHOLDS: ReadonlyArray<{
  unit: Intl.RelativeTimeFormatUnit;
  divisor: number;
}> = [
  { unit: "year", divisor: 31_536_000 }, // 365d
  { unit: "month", divisor: 2_592_000 }, // 30d
  { unit: "week", divisor: 604_800 }, // 7d
  { unit: "day", divisor: 86_400 },
  { unit: "hour", divisor: 3_600 },
  { unit: "minute", divisor: 60 },
  { unit: "second", divisor: 1 },
];

/**
 * Relative time using the platform's native, fully-localized
 * `Intl.RelativeTimeFormat`:
 *
 *   en: "2 hours ago", "in 3 days", "yesterday"
 *   pt: "há 2 horas", "em 3 dias", "ontem"
 *   es: "hace 2 horas", "en 3 días", "ayer"
 *   fr: "il y a 2 heures", "dans 3 jours", "hier"
 *
 * No translation keys needed — Intl ships the entire CLDR for
 * relative time. Pass `now` for tests / deterministic snapshots.
 */
export function formatRelativeTime(
  date: Date | string,
  locale: Locale,
  now: Date = new Date(),
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";

  // Seconds delta — positive = past, negative = future.
  const deltaSec = Math.round((now.getTime() - d.getTime()) / 1000);
  const absSec = Math.abs(deltaSec);
  const sign = deltaSec > 0 ? -1 : 1;

  // Sub-minute → "just now" via "0 seconds ago".
  if (absSec < 60) {
    return getRelativeFormatter(locale, { numeric: "auto" }).format(
      0,
      "second",
    );
  }

  // Find the coarsest unit that produces a magnitude ≥ 1.
  for (const { unit, divisor } of RELATIVE_THRESHOLDS) {
    const magnitude = Math.floor(absSec / divisor);
    if (magnitude >= 1) {
      return getRelativeFormatter(locale, { numeric: "auto" }).format(
        sign * magnitude,
        unit,
      );
    }
  }

  // Fallback (shouldn't reach — second is the floor).
  return getRelativeFormatter(locale, { numeric: "auto" }).format(
    sign * absSec,
    "second",
  );
}
