import { describe, expect, it } from "vitest";
import {
  SITEMAP_STATIC_PATHS,
  buildSitemapEntries,
  type SitemapMarketRow,
} from "@/app/sitemap";
import { DEFAULT_LOCALE, LOCALES } from "@/lib/i18n";

const ORIGIN = "https://kalki.local";
const NOW = new Date("2026-05-26T12:00:00Z");

function markets(...slugs: string[]): SitemapMarketRow[] {
  return slugs.map((slug) => ({
    slug,
    updatedAt: new Date("2026-05-25T08:30:00Z"),
  }));
}

describe("buildSitemapEntries", () => {
  it("emits one entry per (static path × locale)", () => {
    const entries = buildSitemapEntries([], ORIGIN, NOW);
    expect(entries).toHaveLength(
      SITEMAP_STATIC_PATHS.length * LOCALES.length,
    );
  });

  it("emits one entry per (market × locale)", () => {
    const entries = buildSitemapEntries(markets("super-bowl", "us-election"), ORIGIN, NOW);
    const expectedStatic = SITEMAP_STATIC_PATHS.length * LOCALES.length;
    const expectedMarkets = 2 * LOCALES.length;
    expect(entries).toHaveLength(expectedStatic + expectedMarkets);
  });

  it("URLs are absolute and locale-prefixed", () => {
    const entries = buildSitemapEntries(markets("super-bowl"), ORIGIN, NOW);
    for (const e of entries) {
      expect(e.url).toMatch(/^https:\/\/kalki\.local\/(en|pt|es|fr)/);
    }
  });

  it("locale root '/' maps to /{locale} not /{locale}/", () => {
    const entries = buildSitemapEntries([], ORIGIN, NOW);
    const rootEntries = entries.filter((e) =>
      LOCALES.some((l) => e.url === `${ORIGIN}/${l}`),
    );
    expect(rootEntries).toHaveLength(LOCALES.length);
    for (const l of LOCALES) {
      const e = rootEntries.find((x) => x.url === `${ORIGIN}/${l}`);
      expect(e).toBeDefined();
      expect(e!.url.endsWith(`/${l}`)).toBe(true);
      // No trailing slash after the locale segment.
      expect(e!.url.endsWith(`/${l}/`)).toBe(false);
    }
  });

  it("static paths have priority 0.8, locale root has 1.0, markets 0.6", () => {
    const entries = buildSitemapEntries(markets("x"), ORIGIN, NOW);
    const root = entries.find((e) => e.url === `${ORIGIN}/${DEFAULT_LOCALE}`);
    const subPath = entries.find(
      (e) => e.url === `${ORIGIN}/${DEFAULT_LOCALE}/markets`,
    );
    const market = entries.find(
      (e) => e.url === `${ORIGIN}/${DEFAULT_LOCALE}/markets/x`,
    );
    expect(root?.priority).toBe(1.0);
    expect(subPath?.priority).toBe(0.8);
    expect(market?.priority).toBe(0.6);
  });

  it("locale root uses daily change frequency; everything else hourly", () => {
    const entries = buildSitemapEntries(markets("x"), ORIGIN, NOW);
    const root = entries.find((e) => e.url === `${ORIGIN}/${DEFAULT_LOCALE}`);
    const subPath = entries.find(
      (e) => e.url === `${ORIGIN}/${DEFAULT_LOCALE}/markets`,
    );
    expect(root?.changeFrequency).toBe("daily");
    expect(subPath?.changeFrequency).toBe("hourly");
  });

  it("market entry lastModified comes from the row, not the snapshot 'now'", () => {
    const updated = new Date("2024-01-01T00:00:00Z");
    const entries = buildSitemapEntries(
      [{ slug: "x", updatedAt: updated }],
      ORIGIN,
      NOW,
    );
    const m = entries.find(
      (e) => e.url === `${ORIGIN}/${DEFAULT_LOCALE}/markets/x`,
    );
    expect(m?.lastModified).toEqual(updated);
  });

  it("every entry carries a full hreflang block (4 locales + x-default)", () => {
    const entries = buildSitemapEntries(markets("x"), ORIGIN, NOW);
    for (const e of entries) {
      const langs = e.alternates?.languages as Record<string, string>;
      expect(langs).toBeDefined();
      expect(Object.keys(langs).sort()).toEqual(
        [...LOCALES, "x-default"].sort(),
      );
    }
  });

  it("hreflang x-default in each entry points at the DEFAULT_LOCALE variant", () => {
    const entries = buildSitemapEntries(markets("x"), ORIGIN, NOW);
    for (const e of entries) {
      const langs = e.alternates!.languages as Record<string, string>;
      expect(langs["x-default"]).toBe(langs[DEFAULT_LOCALE]);
    }
  });

  it("groups entries by path × locale (no duplicates)", () => {
    const entries = buildSitemapEntries(markets("x", "y"), ORIGIN, NOW);
    const urls = entries.map((e) => e.url);
    const unique = new Set(urls);
    expect(unique.size).toBe(urls.length);
  });

  it("hreflang URLs match the entry URLs (same locale → same URL)", () => {
    // For every entry whose URL is /pt/markets, the entry's
    // alternates.languages.pt should be the same string. Otherwise
    // the sitemap and the page metadata disagree about what /pt/
    // means.
    const entries = buildSitemapEntries(markets("x"), ORIGIN, NOW);
    for (const e of entries) {
      const langs = e.alternates!.languages as Record<string, string>;
      // Find which locale this entry IS, via prefix match.
      const localePrefix = LOCALES.find(
        (l) => e.url === `${ORIGIN}/${l}` || e.url.startsWith(`${ORIGIN}/${l}/`),
      );
      expect(localePrefix).toBeDefined();
      expect(langs[localePrefix!]).toBe(e.url);
    }
  });

  it("trims trailing slash on the origin", () => {
    const entries = buildSitemapEntries([], `${ORIGIN}/`, NOW);
    for (const e of entries) {
      // No double slash after origin.
      expect(e.url).not.toMatch(/^https:\/\/kalki\.local\/\//);
    }
  });

  it("includes /markets + landing pages, excludes auth + authenticated + admin routes", () => {
    expect(SITEMAP_STATIC_PATHS).toContain("/markets");
    expect(SITEMAP_STATIC_PATHS).toContain("/achievements");
    // PR-SINGLE-LOGIN — bet no longer hosts /login or /register; the
    // hub owns the canonical sign-in surface and indexes it from its
    // own sitemap. Indexing them here would point Google at dead URLs.
    expect(SITEMAP_STATIC_PATHS as readonly string[]).not.toContain("/login");
    expect(SITEMAP_STATIC_PATHS as readonly string[]).not.toContain("/register");
    // Authenticated surfaces — should NEVER be indexed.
    expect(SITEMAP_STATIC_PATHS as readonly string[]).not.toContain("/wallet");
    expect(SITEMAP_STATIC_PATHS as readonly string[]).not.toContain("/profile");
    expect(SITEMAP_STATIC_PATHS as readonly string[]).not.toContain("/portfolio");
    expect(SITEMAP_STATIC_PATHS as readonly string[]).not.toContain("/notifications");
    expect(SITEMAP_STATIC_PATHS as readonly string[]).not.toContain("/watchlist");
    expect(SITEMAP_STATIC_PATHS as readonly string[]).not.toContain("/kyc");
    // Admin surface — non-localized + non-indexed.
    expect(SITEMAP_STATIC_PATHS as readonly string[]).not.toContain("/admin");
  });

  it("returns the empty list cleanly when no markets exist (no crashes)", () => {
    const entries = buildSitemapEntries([], ORIGIN, NOW);
    expect(entries.length).toBeGreaterThan(0);
    // No 'undefined' anywhere.
    for (const e of entries) {
      expect(e.url).toBeDefined();
      expect(e.alternates?.languages).toBeDefined();
    }
  });
});
