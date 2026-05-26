import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { LOCALES, DEFAULT_LOCALE } from "@/lib/i18n";

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

  // Static surfaces (path without locale prefix).
  const staticPaths = ["/", "/markets"] as const;

  const entries: MetadataRoute.Sitemap = [];

  for (const path of staticPaths) {
    for (const locale of LOCALES) {
      entries.push({
        url: localizeAbsolute(path, locale),
        lastModified: new Date(),
        changeFrequency: path === "/" ? "daily" : "hourly",
        priority: path === "/" ? 1.0 : 0.8,
        alternates: {
          languages: buildLanguagesBlock(path),
        },
      });
    }
  }

  for (const m of markets) {
    const path = `/markets/${m.slug}`;
    for (const locale of LOCALES) {
      entries.push({
        url: localizeAbsolute(path, locale),
        lastModified: m.updatedAt,
        changeFrequency: "hourly",
        priority: 0.6,
        alternates: {
          languages: buildLanguagesBlock(path),
        },
      });
    }
  }

  return entries;
}

function localizeAbsolute(path: string, locale: string): string {
  return path === "/"
    ? `${ORIGIN}/${locale}`
    : `${ORIGIN}/${locale}${path}`;
}

function buildLanguagesBlock(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of LOCALES) out[l] = localizeAbsolute(path, l);
  // x-default points at the default-locale variant. Google uses this
  // when none of the declared language regions match the user's locale.
  out["x-default"] = localizeAbsolute(path, DEFAULT_LOCALE);
  return out;
}
