/**
 * Locale-aware market content resolution (PR-BET-I18N).
 *
 * Architecture
 * ────────────
 * Markets are stored canonically in `Market.title` / `Market.description`
 * (the authoring language — typically English). Translations live in a
 * sidecar `MarketTranslation` table keyed by `(marketId, locale)`.
 *
 *   • Only markets that have been translated have a row in the sidecar
 *     — no row duplication for the long tail of untranslated content.
 *   • Sidecar columns are nullable so partial translations are
 *     supported (translator fills `title` first, comes back later for
 *     `description`).
 *   • Reader-side fallback is per-field: prefer the sidecar value,
 *     fall back to the canonical field, never blank a UI.
 *
 * Why this shape vs. alternatives
 * ───────────────────────────────
 *   • Cloned-market-per-locale would multiply IDs / slugs / share
 *     URLs by 4×. Rejected — breaks bookmarks and SSE channels.
 *   • Inline JSON column on Market would inflate every read and
 *     complicate `WHERE title ILIKE …` searches. Rejected — sidecar
 *     keeps Market lean.
 *   • Per-locale tables (`MarketEn`, `MarketPt`, …) explode the
 *     schema and force a join on every read. Rejected.
 *
 * Use
 * ───
 *   // Server component (page or route handler):
 *   const market = await db.market.findUnique({
 *     where: { slug },
 *     include: { translations: { where: { locale } } },
 *   });
 *   if (!market) notFound();
 *   const { title, description } = resolveMarketContent(market, locale);
 *
 * `resolveMarketContent` accepts either a `Market` whose `translations`
 * relation was eagerly-loaded with a `where: { locale }` filter (best —
 * one row max returned) OR the unfiltered relation (the helper finds
 * the right row by scanning). Both work; the filtered form is cheaper
 * and idiomatic.
 *
 * IMPORTANT: this module imports the Prisma client *type only* (no
 * runtime). Safe to bundle into client components if ever needed,
 * though right now every call site is server-side.
 */

import type { Locale } from "./config";

/**
 * Minimal shape of a market translation row. Mirrors the Prisma model
 * but declared structurally so the helper accepts hand-built fixtures
 * in tests too.
 */
export interface MarketTranslationLike {
  locale: string;
  title: string | null;
  description: string | null;
}

/**
 * Minimal shape of a market with optional translation rows. Mirrors
 * `Market & { translations: MarketTranslation[] }` but declared
 * structurally so callers can pass either the eager-loaded or
 * separately-fetched variants.
 */
export interface MarketWithTranslations {
  title: string;
  description: string;
  translations?: MarketTranslationLike[] | null;
}

/**
 * Localized projection of `(Market.title, Market.description)`.
 * Always returns non-null strings — falls back to the canonical
 * fields when the sidecar row (or specific field) is missing.
 */
export interface LocalizedMarketContent {
  title: string;
  description: string;
  /** True when the title was sourced from the sidecar; useful for
   *  rendering a small "translated" badge in admin views. */
  titleTranslated: boolean;
  /** Same for description. */
  descriptionTranslated: boolean;
}

/**
 * Resolve the `(title, description)` pair for a market in the
 * requested locale, falling back to canonical fields where the
 * translation is missing.
 *
 * Per-field fallback so a half-finished translation (title only, no
 * description) still picks up the canonical description rather than
 * a blank.
 */
export function resolveMarketContent(
  market: MarketWithTranslations,
  locale: Locale,
): LocalizedMarketContent {
  const tr =
    market.translations?.find((t) => t.locale === locale) ?? undefined;

  // Treat empty strings as "missing" so an admin who accidentally saved
  // a blank translation row doesn't blank the public UI.
  const trTitle =
    tr?.title && tr.title.trim().length > 0 ? tr.title : undefined;
  const trDesc =
    tr?.description && tr.description.trim().length > 0
      ? tr.description
      : undefined;

  return {
    title: trTitle ?? market.title,
    description: trDesc ?? market.description,
    titleTranslated: trTitle !== undefined,
    descriptionTranslated: trDesc !== undefined,
  };
}

/**
 * Prisma `include` clause to eager-load only the translation row for
 * the requested locale. Sized for the common case (one row max) and
 * avoids the n+1 a separate query would create.
 *
 *   const markets = await db.market.findMany({
 *     where: { status: "OPEN" },
 *     include: marketTranslationInclude(locale),
 *   });
 *   const localized = markets.map((m) => ({
 *     ...m,
 *     ...resolveMarketContent(m, locale),
 *   }));
 *
 * Wrapped as a function so the locale parameter is fresh on every
 * call (Prisma `include` literals are otherwise position-locked).
 */
export function marketTranslationInclude(locale: Locale): {
  translations: {
    where: { locale: Locale };
    select: { locale: true; title: true; description: true };
  };
} {
  return {
    translations: {
      where: { locale },
      select: { locale: true, title: true, description: true },
    },
  };
}
