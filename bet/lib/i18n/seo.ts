/**
 * Localized SEO metadata helper (PR-BET-I18N).
 *
 * Every page under `app/[locale]/*` calls `buildLocalizedMetadata` from
 * its `generateMetadata` export. The helper assembles:
 *
 *   • `title`         — localized per page (with site-name template)
 *   • `description`   — localized per page
 *   • `alternates.canonical`        — origin/{locale}{path}
 *   • `alternates.languages`        — every supported locale + `x-default`
 *   • `openGraph` (type, siteName, title, description, locale,
 *      alternateLocale, url, images?)
 *   • `twitter` (card, title, description, images?)
 *   • `robots` — defaults to index/follow for public pages; pass
 *      `noindex: true` for authenticated surfaces (wallet, profile,
 *      portfolio, etc.) so private content doesn't end up in search.
 *
 * Why a helper instead of inlining the metadata in each page?
 *
 *   1. Single source of truth for the OG/Twitter shape — if we add a
 *      new field (e.g. `article:author`), every page picks it up.
 *   2. Forced consistency for canonical/alternates — accidentally
 *      omitting hreflang on one page silently breaks SEO. The helper
 *      makes it impossible to omit.
 *   3. Cleaner pages — `generateMetadata` shrinks to a 5-line call
 *      site instead of 30-line block.
 *
 * IMPORTANT: this module is server-only — it imports `Metadata` from
 * `next` and is called from `generateMetadata` exports which run on
 * the server. Never import from a `"use client"` component.
 */

import type { Metadata } from "next";
import {
  DEFAULT_LOCALE,
  LOCALES,
  alternatesFor,
  isLocale,
  t,
  type Locale,
} from "./index";

const ORIGIN = (
  process.env.NEXTAUTH_URL ?? "http://localhost:3100"
).replace(/\/$/, "");

/**
 * Map our short locale codes to the canonical IETF/OG language_TERRITORY
 * format. Used in `openGraph.locale` and `openGraph.alternateLocale`.
 */
export function openGraphLocale(l: Locale): string {
  switch (l) {
    case "en":
      return "en_US";
    case "pt":
      return "pt_BR";
    case "es":
      return "es_ES";
    case "fr":
      return "fr_FR";
  }
}

export interface LocalizedMetadataInput {
  /** Validated locale, or raw param value (the helper validates). */
  locale: string;
  /**
   * Path WITHOUT the locale prefix. Use "/" for the locale root, or
   * "/markets" / "/markets/super-bowl" for sub-paths.
   */
  path: string;
  /**
   * Page title. Pass the already-translated string (the call site holds
   * the dictionary keys). Will be templated with the site name via
   * `title.template` from the parent metadata.
   */
  title: string;
  /**
   * Page description. Pass the already-translated string. Used as-is
   * for `<meta name="description">`, OG description, and Twitter
   * description.
   */
  description: string;
  /**
   * Optional override for the OG/Twitter image URL. When omitted, the
   * sibling `opengraph-image.tsx` convention (or layout fallback)
   * supplies it.
   */
  image?: string;
  /**
   * Optional override for the OG type. Defaults to "website". Use
   * "article" for content pages, "profile" for user pages, etc.
   */
  ogType?: "website" | "article" | "profile";
  /**
   * Block crawler indexing. Set `true` for authenticated routes that
   * serve user-specific content (wallet, profile, portfolio,
   * notifications, watchlist) — they'd either 401 the crawler or
   * pollute the index with empty pages.
   */
  noindex?: boolean;
}

/**
 * Assemble a complete Next.js `Metadata` block for a localized page.
 *
 *   export async function generateMetadata({ params }) {
 *     const { locale: raw } = await params;
 *     const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
 *     return buildLocalizedMetadata({
 *       locale,
 *       path: "/markets",
 *       title: t("market.heading", locale),
 *       description: t("meta.description", locale),
 *     });
 *   }
 */
export function buildLocalizedMetadata(
  input: LocalizedMetadataInput,
): Metadata {
  const locale: Locale = isLocale(input.locale)
    ? input.locale
    : DEFAULT_LOCALE;
  const path = input.path.startsWith("/") ? input.path : `/${input.path}`;
  const canonicalUrl =
    path === "/" ? `${ORIGIN}/${locale}` : `${ORIGIN}/${locale}${path}`;
  const languages = alternatesFor(ORIGIN, path);
  const siteName = t("meta.siteName", locale);
  const ogType = input.ogType ?? "website";
  const images = input.image ? [{ url: input.image }] : undefined;

  const metadata: Metadata = {
    title: input.title,
    description: input.description,
    alternates: {
      canonical: canonicalUrl,
      languages,
    },
    openGraph: {
      type: ogType,
      siteName,
      title: input.title,
      description: input.description,
      url: canonicalUrl,
      locale: openGraphLocale(locale),
      // Tell crawlers about every other supported locale so unfurl
      // tools can pick the right variant per-user.
      alternateLocale: LOCALES.filter((l) => l !== locale).map(
        openGraphLocale,
      ),
      ...(images ? { images } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description: input.description,
      ...(images ? { images } : {}),
    },
  };

  if (input.noindex) {
    metadata.robots = {
      index: false,
      follow: false,
      googleBot: { index: false, follow: false },
    };
  }

  return metadata;
}
