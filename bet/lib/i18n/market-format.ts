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
 *
 * Scope note: only the enum fields with live call sites are formatted
 * here (category + outcome). Status / trade-action / sort / filter
 * formatters were removed as dead exports — re-add the matching
 * `<FIELD>_KEYS` map + a one-line `t()` wrapper when a UI actually
 * needs to render that field.
 */

import type {
  MarketCategory as PrismaMarketCategory,
  Outcome as PrismaOutcome,
} from "@prisma/client";
import { t, type Locale } from "./index";

/** Re-export Prisma enum types so call sites import from one place. */
export type MarketCategory = PrismaMarketCategory;
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
