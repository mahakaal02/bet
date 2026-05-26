import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALES,
  alternatesFor,
  buildLocalizedMetadata,
  openGraphLocale,
} from "@/lib/i18n";

/**
 * `alternatesFor()` is what every page's `generateMetadata` passes to
 * Next.js to emit `<link rel="alternate" hreflang>` tags. If this
 * function ever drifts, Google indexes duplicate content (one locale
 * per URL with no cross-references) and SEO tanks. Lock the contract
 * down hard.
 */
describe("alternatesFor", () => {
  it("emits one entry per supported locale + x-default", () => {
    const out = alternatesFor("https://kalki.local", "/markets");
    // 4 locales + x-default = 5 keys exactly.
    expect(Object.keys(out)).toHaveLength(LOCALES.length + 1);
    for (const locale of LOCALES) {
      expect(out[locale]).toBeDefined();
    }
    expect(out["x-default"]).toBeDefined();
  });

  it("includes every supported locale code", () => {
    const out = alternatesFor("https://kalki.local", "/wallet");
    expect(Object.keys(out).sort()).toEqual(
      [...LOCALES, "x-default"].sort(),
    );
  });

  it("x-default points to DEFAULT_LOCALE", () => {
    const out = alternatesFor("https://kalki.local", "/markets");
    expect(out["x-default"]).toBe(out[DEFAULT_LOCALE]);
  });

  it("emits absolute URLs (origin-prefixed)", () => {
    const out = alternatesFor("https://kalki.local", "/markets");
    for (const url of Object.values(out)) {
      expect(url).toMatch(/^https:\/\/kalki\.local\//);
    }
  });

  it("handles the locale root path '/' without a double slash", () => {
    const out = alternatesFor("https://kalki.local", "/");
    expect(out.en).toBe("https://kalki.local/en");
    expect(out.pt).toBe("https://kalki.local/pt");
    expect(out.es).toBe("https://kalki.local/es");
    expect(out.fr).toBe("https://kalki.local/fr");
    expect(out["x-default"]).toBe("https://kalki.local/en");
  });

  it("trims a trailing slash from the origin", () => {
    // Common ENV-var foot-gun: NEXTAUTH_URL ending in `/`.
    const out = alternatesFor("https://kalki.local/", "/markets");
    expect(out.en).toBe("https://kalki.local/en/markets");
  });

  it("normalizes a relative path by injecting the leading slash", () => {
    const out = alternatesFor("https://kalki.local", "wallet");
    expect(out.pt).toBe("https://kalki.local/pt/wallet");
  });

  it("produces a complete set of entries for deep paths", () => {
    const out = alternatesFor(
      "https://kalki.local",
      "/markets/super-bowl-winner-2027",
    );
    expect(out.en).toBe(
      "https://kalki.local/en/markets/super-bowl-winner-2027",
    );
    expect(out.fr).toBe(
      "https://kalki.local/fr/markets/super-bowl-winner-2027",
    );
    // Crucially x-default still resolves to the same sub-path under
    // English, not the English root — otherwise Google would think the
    // x-default points at a completely different page.
    expect(out["x-default"]).toBe(out.en);
  });
});

/**
 * The full metadata block returned by `buildLocalizedMetadata` is
 * what every page emits. Verify the entire shape: title, description,
 * canonical, hreflang block, OG fields, Twitter fields, robots
 * (when `noindex` is set).
 */
describe("buildLocalizedMetadata", () => {
  // Origin is read from process.env at the top of the helper module,
  // captured once. Tests use whatever was configured at load time —
  // they assert path SHAPES rather than literal hostnames.

  it("sets canonical to the {origin}/{locale}{path} form", () => {
    const m = buildLocalizedMetadata({
      locale: "pt",
      path: "/markets",
      title: "Mercados",
      description: "…",
    });
    expect(typeof m.alternates?.canonical).toBe("string");
    expect(m.alternates!.canonical).toMatch(/\/pt\/markets$/);
  });

  it("emits a full hreflang block (4 locales + x-default)", () => {
    const m = buildLocalizedMetadata({
      locale: "en",
      path: "/leaderboard",
      title: "Leaderboard",
      description: "…",
    });
    const langs = m.alternates?.languages as Record<string, string>;
    expect(langs).toBeDefined();
    expect(Object.keys(langs).sort()).toEqual(
      [...LOCALES, "x-default"].sort(),
    );
  });

  it("propagates title + description into OpenGraph + Twitter", () => {
    const m = buildLocalizedMetadata({
      locale: "fr",
      path: "/markets",
      title: "Marchés de prédiction",
      description: "Tradez sur des événements réels…",
    });
    expect(m.title).toBe("Marchés de prédiction");
    expect(m.description).toBe("Tradez sur des événements réels…");

    // OpenGraph mirror.
    expect(m.openGraph?.title).toBe("Marchés de prédiction");
    expect(m.openGraph?.description).toBe("Tradez sur des événements réels…");

    // Twitter mirror.
    expect(m.twitter?.title).toBe("Marchés de prédiction");
    expect(m.twitter?.description).toBe("Tradez sur des événements réels…");
  });

  it("emits the OG locale in the canonical IETF form (language_TERRITORY)", () => {
    expect(
      buildLocalizedMetadata({
        locale: "pt",
        path: "/",
        title: "x",
        description: "y",
      }).openGraph?.locale,
    ).toBe("pt_BR");
    expect(openGraphLocale("en")).toBe("en_US");
    expect(openGraphLocale("es")).toBe("es_ES");
    expect(openGraphLocale("fr")).toBe("fr_FR");
  });

  it("lists every OTHER locale as alternate (excludes self)", () => {
    const m = buildLocalizedMetadata({
      locale: "pt",
      path: "/",
      title: "x",
      description: "y",
    });
    const alts = (m.openGraph?.alternateLocale ?? []) as string[];
    expect(alts).toContain("en_US");
    expect(alts).toContain("es_ES");
    expect(alts).toContain("fr_FR");
    expect(alts).not.toContain("pt_BR"); // the page's own locale
    expect(alts).toHaveLength(LOCALES.length - 1);
  });

  it("defaults to ogType 'website'", () => {
    const m = buildLocalizedMetadata({
      locale: "en",
      path: "/",
      title: "x",
      description: "y",
    });
    // `Metadata.openGraph` is a discriminated union per OG type;
    // the `type` discriminator lives on each variant but isn't lifted
    // to the union itself. Cast to access the runtime field.
    const og = m.openGraph as { type?: string } | undefined;
    expect(og?.type).toBe("website");
  });

  it("respects ogType override (article for market detail pages)", () => {
    const m = buildLocalizedMetadata({
      locale: "en",
      path: "/markets/x",
      title: "x",
      description: "y",
      ogType: "article",
    });
    const og = m.openGraph as { type?: string } | undefined;
    expect(og?.type).toBe("article");
  });

  it("sets robots noindex when requested (authenticated surfaces)", () => {
    const m = buildLocalizedMetadata({
      locale: "en",
      path: "/wallet",
      title: "Wallet",
      description: "…",
      noindex: true,
    });
    // Type-checker happy form — Metadata.robots can be string|object.
    const robots = m.robots as { index?: boolean; follow?: boolean } | string;
    if (typeof robots === "string") {
      expect(robots).toMatch(/noindex/i);
    } else {
      expect(robots.index).toBe(false);
      expect(robots.follow).toBe(false);
    }
  });

  it("does NOT emit a robots block on public pages (default)", () => {
    const m = buildLocalizedMetadata({
      locale: "en",
      path: "/markets",
      title: "Markets",
      description: "…",
    });
    expect(m.robots).toBeUndefined();
  });

  it("the canonical URL is one of the hreflang alternates (consistency)", () => {
    const m = buildLocalizedMetadata({
      locale: "fr",
      path: "/markets",
      title: "Marchés",
      description: "…",
    });
    const langs = m.alternates?.languages as Record<string, string>;
    expect(Object.values(langs)).toContain(m.alternates?.canonical);
  });
});

describe("openGraphLocale (IETF mapping)", () => {
  it("maps each supported locale to its canonical language_TERRITORY", () => {
    expect(openGraphLocale("en")).toBe("en_US");
    expect(openGraphLocale("pt")).toBe("pt_BR");
    expect(openGraphLocale("es")).toBe("es_ES");
    expect(openGraphLocale("fr")).toBe("fr_FR");
  });
});
