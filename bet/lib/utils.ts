import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { DEFAULT_LOCALE, type Locale } from "./i18n/config";
import { formatCoins, formatPrice, formatRelativeTime } from "./i18n/format";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format an integer coin balance with locale-aware thousands
 * separators (1,234 en · 1.234 pt · 1 234 fr).
 *
 * Thin wrapper over the canonical `formatCoins` in `i18n/format` so
 * coins render identically wherever they appear — there's exactly one
 * Intl-backed implementation, no drift. `locale` is optional and
 * defaults to English so non-localized surfaces (admin tooling, the
 * crypto-topup return page, any server util without a locale in scope)
 * keep their current output without a code change. Localized call
 * sites under `[locale]/` should pass their active `locale`.
 */
export function fmtCoins(n: number | bigint, locale: Locale = DEFAULT_LOCALE): string {
  return formatCoins(n, locale);
}

/** Format a 0..1 probability as a percentage string. Deliberately NOT
 *  locale-aware: this is also used for raw CSS widths
 *  (`style={{ width: fmtPct(x) }}`), where a localized decimal comma
 *  ("55,0%") would be an invalid CSS length. Kept ASCII for that reason;
 *  prefer `fmtPrice` for market prices and `formatPercent` (i18n) for
 *  display-only percentages. */
export function fmtPct(p: number, digits = 0): string {
  return `${(p * 100).toFixed(digits)}%`;
}

/**
 * Format a 0..1 market price as a decimal string ("0.55" en, "0,55"
 * pt/fr). This is how prediction markets like Polymarket and Kalshi
 * quote — a YES share trading at 0.55 means the market thinks YES has a
 * 55% chance, AND you pay 0.55 coins per share, AND you receive 1 coin
 * per share on a YES resolution.
 *
 * Delegates to the canonical `formatPrice` (Intl-backed, locale-aware
 * decimal separator). `locale` defaults to English; localized call
 * sites should pass their active `locale`.
 */
export function fmtPrice(p: number, digits = 2, locale: Locale = DEFAULT_LOCALE): string {
  return formatPrice(p, locale, digits);
}

/**
 * Short relative time, fully localized via the platform's
 * `Intl.RelativeTimeFormat` ("2 minutes ago" en · "há 2 minutos" pt ·
 * "il y a 2 minutes" fr · "yesterday"/"ontem"/"hier").
 *
 * Delegates to the canonical `formatRelativeTime` so the entire app
 * speaks the same relative-time strings (and gets graceful "—" for
 * invalid dates, which the old hand-rolled English version didn't).
 * `locale` defaults to English; localized call sites should pass their
 * active `locale`.
 */
export function timeAgo(iso: Date | string, locale: Locale = DEFAULT_LOCALE): string {
  return formatRelativeTime(iso, locale);
}

/** XP needed to reach the given level. Curve: level n requires n*250 XP. */
export function xpForLevel(level: number): number {
  return level * 250;
}

export function levelFromXp(xp: number): { level: number; toNext: number; progress: number } {
  let level = 1;
  let acc = 0;
  while (acc + xpForLevel(level) <= xp) {
    acc += xpForLevel(level);
    level += 1;
  }
  const within = xp - acc;
  const need = xpForLevel(level);
  return { level, toNext: need - within, progress: within / need };
}
