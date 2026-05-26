import type { MetadataRoute } from "next";
import { LOCALES, DEFAULT_LOCALE, type Locale } from "@/lib/i18n";

/**
 * Per-locale sitemap (PR-AUCTIONS-I18N).
 *
 * Emits one entry per (page × locale) so Google indexes the full
 * `[locale]` tree. Each entry carries an `alternates.languages`
 * block, which tells Google these URLs are translations of each
 * other and prevents duplicate-content penalisation.
 *
 * Coverage:
 *   • Hub landing (/) — requires sign-in for the personalised view
 *     but the URL itself is the canonical landing for SEO.
 *   • Auctions catalog (/auctions) — public list of live auctions.
 *
 * Skipped on purpose:
 *   • Individual auction detail pages (/auctions/:id) — the list is
 *     short-lived; auctions close in days, not weeks. Indexing each
 *     transient slug pollutes the search index. The list page above
 *     gives Google the live entry point.
 *   • /api/* — non-HTML responses; never indexed regardless.
 *   • Authenticated routes (/profile, /me/*, /notifications) —
 *     they serve user-specific content and aren't indexable.
 *   • /share/* — bot-rendered preview surfaces; bots reach those
 *     directly via shared links, not via the sitemap.
 */
export const dynamic = "force-dynamic";

const ORIGIN = (
  process.env.NEXT_PUBLIC_AUCTIONS_URL ?? "http://localhost:3200"
).replace(/\/$/, "");

/**
 * Static surfaces (paths without locale prefix). Order roughly
 * matches the user's discovery flow — landing → catalog.
 *
 * Authenticated routes intentionally omitted: they serve user-
 * specific content and would either 401 the crawler or pollute
 * the index with empty pages.
 *
 * Exported so tests can assert on the canonical list rather than
 * hard-coding it in two places.
 */
export const SITEMAP_STATIC_PATHS = ["/", "/auctions"] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return buildSitemapEntries(ORIGIN);
}

/**
 * Pure sitemap builder — no DB, no Date.now() dependency, no env
 * reads. Origin is the only input; output is the Next.js sitemap
 * structure ready to be returned from the route. Kept as a separate
 * exported function so tests can verify every entry (URL,
 * alternates, change-frequency, priority) deterministically.
 */
export function buildSitemapEntries(
  origin: string,
  now: Date = new Date(),
): MetadataRoute.Sitemap {
  const base = origin.replace(/\/$/, "");
  const entries: MetadataRoute.Sitemap = [];

  for (const path of SITEMAP_STATIC_PATHS) {
    for (const locale of LOCALES) {
      entries.push({
        url: localizeAbsolute(path, locale, base),
        lastModified: now,
        changeFrequency: path === "/" ? "daily" : "hourly",
        priority: path === "/" ? 1.0 : 0.8,
        alternates: {
          languages: buildLanguagesBlock(path, base),
        },
      });
    }
  }

  return entries;
}

function localizeAbsolute(path: string, locale: Locale, base: string): string {
  return path === "/" ? `${base}/${locale}` : `${base}/${locale}${path}`;
}

function buildLanguagesBlock(
  path: string,
  base: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of LOCALES) out[l] = localizeAbsolute(path, l, base);
  // x-default points at the default-locale variant. Google uses this
  // when none of the declared language regions match the user's locale.
  out["x-default"] = localizeAbsolute(path, DEFAULT_LOCALE, base);
  return out;
}
