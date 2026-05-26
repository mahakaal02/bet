import { describe, expect, it } from "vitest";
import { parseAcceptLanguage } from "@/lib/i18n";

/**
 * RFC 7231 §5.3.5 — Accept-Language parser tests.
 *
 * Supported locales (per `lib/i18n/config.ts`): en, pt, es, fr.
 * Anything else is filtered out — we don't fabricate fake matches.
 */
describe("parseAcceptLanguage", () => {
  describe("basics", () => {
    it("returns empty array for null/undefined/empty input", () => {
      expect(parseAcceptLanguage(null)).toEqual([]);
      expect(parseAcceptLanguage(undefined)).toEqual([]);
      expect(parseAcceptLanguage("")).toEqual([]);
      expect(parseAcceptLanguage("   ")).toEqual([]);
    });

    it("parses a single supported tag", () => {
      expect(parseAcceptLanguage("en")).toEqual(["en"]);
      expect(parseAcceptLanguage("pt")).toEqual(["pt"]);
    });

    it("returns empty array when no tags match supported locales", () => {
      expect(parseAcceptLanguage("zh-CN,ja,de")).toEqual([]);
    });

    it("preserves header order for equal q-values", () => {
      // Both implicit q=1; fr should come before en because that's the
      // order the browser listed them.
      expect(parseAcceptLanguage("fr-CA,en-US")).toEqual(["fr", "en"]);
    });
  });

  describe("q-value handling", () => {
    it("sorts by q descending", () => {
      // en is q=0.5, fr is q=0.9 → fr first.
      expect(parseAcceptLanguage("en;q=0.5,fr;q=0.9")).toEqual(["fr", "en"]);
    });

    it("treats missing q as 1.0", () => {
      // en defaults to 1.0; fr is 0.9 → en wins.
      expect(parseAcceptLanguage("fr;q=0.9,en")).toEqual(["en", "fr"]);
    });

    it("drops entries with q=0 (RFC 'not acceptable')", () => {
      expect(parseAcceptLanguage("en;q=0,fr;q=0.9")).toEqual(["fr"]);
    });

    it("clamps q-values above 1 down to 1", () => {
      // Both entries clamp to 1; stable sort keeps original order.
      expect(parseAcceptLanguage("fr;q=2.0,en;q=99")).toEqual(["fr", "en"]);
    });

    it("clamps negative q-values to 0 (filtered)", () => {
      expect(parseAcceptLanguage("en;q=-0.5,fr;q=0.5")).toEqual(["fr"]);
    });

    it("ignores invalid q-values (treats as default 1)", () => {
      // q=abc isn't finite → falls back to the default 1.0.
      expect(parseAcceptLanguage("fr;q=abc,en;q=0.5")).toEqual(["fr", "en"]);
    });
  });

  describe("region / script stripping", () => {
    it("collapses fr-CA to fr", () => {
      expect(parseAcceptLanguage("fr-CA")).toEqual(["fr"]);
    });

    it("collapses pt-BR to pt", () => {
      expect(parseAcceptLanguage("pt-BR,pt;q=0.8")).toEqual(["pt"]);
    });

    it("handles underscore separator (fr_CA → fr)", () => {
      expect(parseAcceptLanguage("fr_CA")).toEqual(["fr"]);
    });

    it("collapses multi-level subtags (fr-Latn-CA → fr)", () => {
      expect(parseAcceptLanguage("fr-Latn-CA")).toEqual(["fr"]);
    });

    it("dedupes when region + base both appear", () => {
      // fr-CA collapses to fr; fr already counted; only one entry.
      expect(parseAcceptLanguage("fr-CA,fr;q=0.9")).toEqual(["fr"]);
    });
  });

  describe("wildcards and edge cases", () => {
    it("skips the wildcard `*`", () => {
      // Wildcard yields no info — only en remains.
      expect(parseAcceptLanguage("*;q=0.5,en;q=0.8")).toEqual(["en"]);
    });

    it("returns empty when only wildcards / unsupported tags present", () => {
      expect(parseAcceptLanguage("*")).toEqual([]);
      expect(parseAcceptLanguage("*,zh,ja")).toEqual([]);
    });

    it("tolerates whitespace inside parameters", () => {
      expect(parseAcceptLanguage(" fr ; q = 0.9 , en ; q = 0.5 ")).toEqual([
        "fr",
        "en",
      ]);
    });

    it("ignores unknown parameters", () => {
      // Some clients send extras like ;level=1. We only care about q=.
      expect(parseAcceptLanguage("fr;level=1;q=0.9,en")).toEqual(["en", "fr"]);
    });

    it("lower-cases tags before matching", () => {
      expect(parseAcceptLanguage("FR-CA,EN-US;q=0.5")).toEqual(["fr", "en"]);
    });

    it("handles trailing commas / empty entries gracefully", () => {
      expect(parseAcceptLanguage("fr,,en,,,")).toEqual(["fr", "en"]);
    });
  });

  describe("real-world headers", () => {
    it('"fr-CA,fr;q=0.9,en;q=0.5" → ["fr", "en"]', () => {
      expect(parseAcceptLanguage("fr-CA,fr;q=0.9,en;q=0.5")).toEqual([
        "fr",
        "en",
      ]);
    });

    it('Chrome-style "en-US,en;q=0.9,pt;q=0.8,es;q=0.7"', () => {
      expect(
        parseAcceptLanguage("en-US,en;q=0.9,pt;q=0.8,es;q=0.7"),
      ).toEqual(["en", "pt", "es"]);
    });

    it('Brazilian Chrome "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"', () => {
      expect(
        parseAcceptLanguage("pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"),
      ).toEqual(["pt", "en"]);
    });

    it('Firefox-style "fr,fr-FR;q=0.8,en-US;q=0.5,en;q=0.3"', () => {
      expect(
        parseAcceptLanguage("fr,fr-FR;q=0.8,en-US;q=0.5,en;q=0.3"),
      ).toEqual(["fr", "en"]);
    });

    it('Wildcard-tailed "es-MX,es;q=0.9,*;q=0.5"', () => {
      expect(parseAcceptLanguage("es-MX,es;q=0.9,*;q=0.5")).toEqual(["es"]);
    });

    it("rejects garbage gracefully", () => {
      expect(parseAcceptLanguage(";;;;")).toEqual([]);
      expect(parseAcceptLanguage("q=0.5")).toEqual([]);
      expect(parseAcceptLanguage(",,,;;")).toEqual([]);
    });
  });
});
