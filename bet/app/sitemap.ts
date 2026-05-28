import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { LOCALES, DEFAULT_LOCALE, type Locale } from "@/lib/i18n";

/**
 * Per-locale sitemap (PR-BET-I18N).
 *
 * Emits one entry per (page × locale) so Google indexes the full
 * `[locale]` tree. Each entry carries an `alternates.languages`
 * block, which tells Google these URLs are translations of each
 * other and prevents duplicate-content penalisation.
 *
 * Coverage:
 *   • Static landing pages (home + markets list)
 *   • Per-market detail pages (limit 1000 for budget — paginate in
 *     a follow-up if the catalog grows past that)
 *
 * Skipped on purpose:
 *   • /admin/* — operator surface; do not index
 *   • /api/* — non-HTML responses; never indexed regardless
 *   • Authenticated routes (wallet, profile, portfolio) — they
 *     serve user-specific content and aren't indexable
 */
export const dynamic = "force-dynamic";

const ORIGIN = (process.env.NEXTAUTH_URL ?? "http://localhost:3100").replace(
  /\/$/,
  "",
);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const markets = await db.market.findMany({
    where: { status: { in: ["OPEN", "RESOLVED"] } },
    orderBy: { createdAt: "desc" },
    take: 1000,
    select: { slug: true, updatedAt: true },
  });

  // Delegate the actual sitemap-shape construction to a pure builder
  // so the tests can exercise it without touching the database.
  return buildSitemapEntries(markets, ORIGIN);
}

/**
 * Static surfaces (paths without locale prefix). Order roughly
 * matches the user's discovery flow — landing → catalog →
 * reference pages.
 *
 * Authenticated routes (/wallet, /profile, /portfolio, /watchlist,
 * /notifications) intentionally omitted: they serve user-specific
 * content and would either 401 the crawler or pollute the index
 * with empty pages.
 *
 * Exported so tests assert on the canonical list rather than
 * hard-coding it in two places.
 */
// PR-SINGLE-LOGIN — `/login` and `/register` removed; bet no longer
// hosts those pages. The hub (auctions origin) owns the canonical
// sign-in surface and is indexed from that site's own sitemap.
export const SITEMAP_STATIC_PATHS = [
  "/",
  "/markets",
  "/achievements",
] as const;

export interface SitemapMarketRow {
  slug: string;
  updatedAt: Date;
}

/**
 * Pure sitemap builder — no DB, no Date.now(), no env reads. Inputs
 * are the market rows + origin; output is the Next.js sitemap
 * structure ready to be returned from the route. Kept as a separate
 * exported function so tests can construct exact-fixture inputs and
 * verify every entry (URL, alternates, change-frequency, priority)
 * without standing up Prisma.
 */
export function buildSitemapEntries(
  markets: SitemapMarketRow[],
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

  for (const m of markets) {
    const path = `/markets/${m.slug}`;
    for (const locale of LOCALES) {
      entries.push({
        url: localizeAbsolute(path, locale, base),
        lastModified: m.updatedAt,
        changeFrequency: "hourly",
        priority: 0.6,
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
