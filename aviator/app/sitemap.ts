import type { MetadataRoute } from "next";
import { LOCALES, DEFAULT_LOCALE, type Locale } from "@/lib/i18n";

/**
 * Per-locale sitemap (PR-AVIATOR-I18N).
 *
 * Emits one entry per (page × locale) so Google indexes the full
 * `[locale]` tree. Each entry carries an `alternates.languages`
 * block, which tells Google these URLs are translations of each
 * other and prevents duplicate-content penalisation.
 *
 * Coverage:
 *   • Home (the game stage) — primary landing
 *   • Fairness — public, explains the provably-fair mechanism;
 *     good SEO surface for trust + understanding the game
 *
 * Skipped on purpose:
 *   • /profile, /notifications, /withdraw — authenticated, user-
 *     specific content; not indexable
 *   • /logout — transient redirect surface; never indexable
 *   • /api/* — non-HTML responses; never indexed regardless
 */
export const dynamic = "force-dynamic";

const ORIGIN = (
  process.env.NEXT_PUBLIC_AVIATOR_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return buildSitemapEntries(ORIGIN);
}

/**
 * Static surfaces (paths without locale prefix). Order roughly
 * matches the user's discovery flow — landing → reference pages.
 *
 * Authenticated routes (/profile, /notifications, /withdraw,
 * /logout) intentionally omitted: they serve user-specific
 * content and would either 401 the crawler or pollute the index
 * with empty pages.
 *
 * Exported so tests assert on the canonical list rather than
 * hard-coding it in two places.
 */
export const SITEMAP_STATIC_PATHS = ["/", "/fairness"] as const;

/**
 * Pure sitemap builder — no DB, no Date.now() (modulo a default
 * arg), no env reads. Inputs are the origin; output is the
 * Next.js sitemap structure ready to be returned from the route.
 * Kept as a separate exported function so tests can construct
 * exact-fixture inputs and verify every entry (URL, alternates,
 * change-frequency, priority) deterministically.
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
        changeFrequency: path === "/" ? "daily" : "weekly",
        priority: path === "/" ? 1.0 : 0.7,
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
