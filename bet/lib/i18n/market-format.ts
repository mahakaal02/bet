/**
 * Locale-aware formatters for the dynamic-but-enumerated fields on
 * a Market (PR-BET-I18N).
 *
 * These wrap `t()` with a typed API so call sites get exhaustiveness
 * checks instead of stringly-typed dictionary paths. If a new
 * `MarketCategory` is added to Prisma, TypeScript fails the build
 * here until a translation key is mapped — exactly the safety the
 * old `categoryLabel(category)` helpers lacked.
 *
 * Fallback semantics: every formatter ultimately delegates to
 * `t(key, locale)`, which falls back to English when the locale
 * dictionary lacks the key (deep walker in `./index.ts`). So even a
 * brand-new category renders sanely the moment it's added to
 * `en.ts`; pt/es/fr can follow asynchronously.
 *
 * IMPORTANT: keep this module free of Prisma client imports — it's
 * imported by both server and client components and bundling
 * `@prisma/client` into the browser bundle would explode the wire
 * size. Use the Prisma enum *types* via `import type` only.
 */

import type {
  MarketCategory as PrismaMarketCategory,
  MarketStatus as PrismaMarketStatus,
  Outcome as PrismaOutcome,
} from "@prisma/client";
import { t, type Locale } from "./index";

/** Re-export Prisma enum types so call sites import from one place. */
export type MarketCategory = PrismaMarketCategory;
export type MarketStatus = PrismaMarketStatus;
export type Outcome = PrismaOutcome;

/* ============================================================
   Category — used on filter chips, badges, list-page headings
   ============================================================ */

const CATEGORY_KEYS: Record<MarketCategory, string> = {
  POLITICS: "market.categoryPolitics",
  SPORTS: "market.categorySports",
  CRYPTO: "market.categoryCrypto",
  TECH: "market.categoryTech",
  ENTERTAINMENT: "market.categoryEnt",
};

export function formatCategory(
  category: MarketCategory,
  locale: Locale,
): string {
  return t(CATEGORY_KEYS[category], locale);
}

/** All categories paired with their localized labels — convenient for
 *  building dropdowns / filter chips without hard-coding the enum
 *  iteration in every page. */
export function listCategories(
  locale: Locale,
): { value: MarketCategory; label: string }[] {
  return (Object.keys(CATEGORY_KEYS) as MarketCategory[]).map((value) => ({
    value,
    label: formatCategory(value, locale),
  }));
}

/* ============================================================
   Status — OPEN / CLOSED / RESOLVED / CANCELLED
   ============================================================ */

const STATUS_KEYS: Record<MarketStatus, string> = {
  OPEN: "market.statusOpen",
  CLOSED: "market.statusClosed",
  RESOLVED: "market.statusResolved",
  CANCELLED: "market.statusCancelled",
};

export function formatStatus(
  status: MarketStatus,
  locale: Locale,
): string {
  return t(STATUS_KEYS[status], locale);
}

/* ============================================================
   Outcome — YES / NO
   ============================================================ */

const OUTCOME_KEYS: Record<Outcome, string> = {
  YES: "market.yes",
  NO: "market.no",
};

export function formatOutcome(outcome: Outcome, locale: Locale): string {
  return t(OUTCOME_KEYS[outcome], locale);
}

/**
 * Resolved label like "Resolved YES" — common pattern on resolved
 * cards. Combines the localized "Resolved" word with the localized
 * outcome via the `{outcome}` interpolation slot already in the
 * dictionary.
 */
export function formatResolvedAs(
  resolvedAs: Outcome,
  locale: Locale,
): string {
  return t("market.resolvedOutcome", locale, {
    outcome: formatOutcome(resolvedAs, locale),
  });
}

/* ============================================================
   Action text — buttons + CTA labels
   ============================================================ */

export type TradeAction = "BUY" | "SELL";

const TRADE_ACTION_KEYS: Record<TradeAction, string> = {
  BUY: "market.buy",
  SELL: "market.sell",
};

export function formatTradeAction(
  action: TradeAction,
  locale: Locale,
): string {
  return t(TRADE_ACTION_KEYS[action], locale);
}

/** Combined "Buy YES" / "Sell NO" CTA label. */
export function formatTradeActionWithOutcome(
  action: TradeAction,
  outcome: Outcome,
  locale: Locale,
): string {
  const outcomeLabel = formatOutcome(outcome, locale);
  return action === "BUY"
    ? t("market.buyOutcome", locale, { outcome: outcomeLabel })
    : t("market.sellOutcome", locale, { outcome: outcomeLabel });
}

/* ============================================================
   Sort / filter options — pre-computed lists for picker UIs
   ============================================================ */

export type MarketSort = "trending" | "volume" | "ending" | "newest";

const SORT_KEYS: Record<MarketSort, string> = {
  trending: "market.sortTrending",
  volume: "market.sortVolume",
  ending: "market.sortEnding",
  newest: "market.sortNewest",
};

export function formatSort(sort: MarketSort, locale: Locale): string {
  return t(SORT_KEYS[sort], locale);
}

export function listSorts(
  locale: Locale,
): { value: MarketSort; label: string }[] {
  return (Object.keys(SORT_KEYS) as MarketSort[]).map((value) => ({
    value,
    label: formatSort(value, locale),
  }));
}

export type MarketFilter = "open" | "resolved" | "all";

const FILTER_KEYS: Record<MarketFilter, string> = {
  open: "market.filterOpen",
  resolved: "market.filterResolved",
  all: "market.filterAll",
};

export function formatFilter(filter: MarketFilter, locale: Locale): string {
  return t(FILTER_KEYS[filter], locale);
}

export function listFilters(
  locale: Locale,
): { value: MarketFilter; label: string }[] {
  return (Object.keys(FILTER_KEYS) as MarketFilter[]).map((value) => ({
    value,
    label: formatFilter(value, locale),
  }));
}
