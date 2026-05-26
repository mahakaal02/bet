import { describe, expect, it } from "vitest";
import {
  formatCoins,
  formatCompact,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatPrice,
  formatRelativeTime,
} from "@/lib/i18n";

/**
 * Locale-aware Intl formatter tests (PR-BET-I18N — Phase 4).
 *
 * We don't snapshot Intl output (CLDR strings drift between Node
 * versions). Instead, assertions probe:
 *   • The locale's expected separator characters (comma vs dot vs
 *     thin-space) appear in numbers
 *   • Currency symbol matches the locale convention
 *   • Date words for the right language appear
 *   • Relative time produces a localized phrase containing the
 *     expected language fragments
 *
 * This keeps tests robust to minor CLDR data changes while still
 * catching regressions that swap locales (e.g. accidentally hard-
 * coding "en-US" again).
 */

describe("formatNumber — locale-aware separators", () => {
  it("uses comma+dot for en (1,234,567.89)", () => {
    expect(formatNumber(1234567.89, "en")).toBe("1,234,567.89");
  });

  it("uses dot+comma for pt-BR (1.234.567,89)", () => {
    expect(formatNumber(1234567.89, "pt")).toBe("1.234.567,89");
  });

  it("uses dot+comma for es-ES (1.234.567,89)", () => {
    expect(formatNumber(1234567.89, "es")).toBe("1.234.567,89");
  });

  it("uses thin-space group + comma decimal for fr-FR", () => {
    // fr-FR uses U+202F (narrow no-break space) as a grouping
    // separator and "," as the decimal point. We assert by parts to
    // tolerate fonts/normalisation rather than pasting the exact
    // unicode bytes.
    const out = formatNumber(1234567.89, "fr");
    expect(out).toContain(","); // decimal
    expect(out.replace(/[\s  ]/g, "")).toBe("1234567,89");
  });

  it("returns '—' for non-finite inputs", () => {
    expect(formatNumber(NaN, "en")).toBe("—");
    expect(formatNumber(Infinity, "en")).toBe("—");
    expect(formatNumber(-Infinity, "en")).toBe("—");
  });

  it("handles bigint losslessly", () => {
    expect(formatNumber(9_999_999_999n, "en")).toBe("9,999,999,999");
  });
});

describe("formatCoins — integer-only display", () => {
  it("drops decimals (4-decimal share counts → integer coin counts)", () => {
    expect(formatCoins(1234.789, "en")).toBe("1,235");
    expect(formatCoins(1234.789, "pt")).toBe("1.235");
  });

  it("formats 0 cleanly", () => {
    expect(formatCoins(0, "en")).toBe("0");
    expect(formatCoins(0, "pt")).toBe("0");
  });
});

describe("formatCompact — K / M / B short notation", () => {
  it("emits K for thousands in en", () => {
    expect(formatCompact(1234, "en")).toMatch(/1\.?2K|1,2 ?K/);
  });

  it("emits M for millions in en", () => {
    expect(formatCompact(1_500_000, "en")).toMatch(/1\.?5M|1,5 ?M/);
  });

  it("localizes compact suffixes (pt-BR uses 'mil')", () => {
    // pt-BR uses "mil" for thousands instead of "K"
    const out = formatCompact(2500, "pt");
    // Should contain something other than just digits — either "mil"
    // or "K", depending on CLDR version. Just assert it's compacter
    // than the full digit count.
    expect(out.length).toBeLessThanOrEqual(7);
  });
});

describe("formatPercent — 0..1 ratio", () => {
  it("renders integer percent by default in en", () => {
    expect(formatPercent(0.55, "en")).toBe("55%");
    expect(formatPercent(0.075, "en")).toBe("8%"); // rounds
  });

  it("renders integer percent in fr-FR (with NBSP before %)", () => {
    const out = formatPercent(0.55, "fr");
    // fr-FR uses U+202F (narrow no-break) before % in newer CLDR
    expect(out.replace(/[\s  ]/g, "")).toBe("55%");
  });

  it("respects requested digit count", () => {
    expect(formatPercent(0.12345, "en", 2)).toBe("12.35%");
  });

  it("returns '—' for non-finite", () => {
    expect(formatPercent(NaN, "en")).toBe("—");
  });
});

describe("formatCurrency — locale + currency", () => {
  it("renders INR as ₹ for en", () => {
    expect(formatCurrency(1234, "en", "INR")).toContain("₹");
  });

  it("renders EUR with € on the appropriate side for fr-FR (suffix)", () => {
    const out = formatCurrency(1234.5, "fr", "EUR");
    expect(out).toContain("€");
    // In fr-FR convention the € comes AFTER the amount.
    expect(out.trim().endsWith("€")).toBe(true);
  });

  it("returns '—' for non-finite", () => {
    expect(formatCurrency(NaN, "en", "INR")).toBe("—");
  });
});

describe("formatPrice — decimal market quote", () => {
  it("renders 2-decimal price in en", () => {
    expect(formatPrice(0.55, "en")).toBe("0.55");
  });

  it("renders 2-decimal price with comma decimal in pt", () => {
    expect(formatPrice(0.55, "pt")).toBe("0,55");
  });

  it("returns '—' for non-finite", () => {
    expect(formatPrice(NaN, "en")).toBe("—");
  });

  it("preserves leading zero", () => {
    expect(formatPrice(0.05, "en")).toBe("0.05");
    expect(formatPrice(0.05, "fr")).toBe("0,05");
  });
});

describe("formatDate — locale-aware dates", () => {
  const sample = new Date("2026-05-26T12:00:00Z");

  it("includes 'May' in en", () => {
    const out = formatDate(sample, "en");
    expect(out.toLowerCase()).toContain("may");
  });

  it("includes 'mai' in pt-BR / fr-FR", () => {
    expect(formatDate(sample, "pt").toLowerCase()).toMatch(/mai/);
    expect(formatDate(sample, "fr").toLowerCase()).toMatch(/mai/);
  });

  it("includes 'may' in es-ES", () => {
    expect(formatDate(sample, "es").toLowerCase()).toMatch(/may/);
  });

  it("accepts ISO strings", () => {
    expect(formatDate("2026-05-26T12:00:00Z", "en")).toBe(
      formatDate(sample, "en"),
    );
  });

  it("returns '—' for invalid dates", () => {
    expect(formatDate(new Date("invalid"), "en")).toBe("—");
    expect(formatDate("not-a-date", "en")).toBe("—");
  });
});

describe("formatDateTime — date + time", () => {
  it("contains both date components and a time portion", () => {
    const out = formatDateTime(new Date("2026-05-26T17:23:00Z"), "en");
    // Year + a colon (time separator) in the same string
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/:/);
  });
});

describe("formatRelativeTime — localized 'ago' / 'in N'", () => {
  // Anchor "now" so tests are deterministic across CI runs.
  const NOW = new Date("2026-05-26T12:00:00Z");

  it("renders 'ago' phrasing for past times in en", () => {
    const out = formatRelativeTime(
      new Date(NOW.getTime() - 2 * 3600 * 1000),
      "en",
      NOW,
    );
    expect(out.toLowerCase()).toContain("ago");
    expect(out).toContain("2");
    expect(out.toLowerCase()).toContain("hour");
  });

  it("renders 'há' for past in pt", () => {
    const out = formatRelativeTime(
      new Date(NOW.getTime() - 3 * 86400 * 1000),
      "pt",
      NOW,
    );
    expect(out).toContain("há");
    expect(out).toContain("3");
  });

  it("renders 'hace' for past in es", () => {
    const out = formatRelativeTime(
      new Date(NOW.getTime() - 5 * 60 * 1000),
      "es",
      NOW,
    );
    expect(out).toContain("hace");
  });

  it("renders 'il y a' for past in fr", () => {
    const out = formatRelativeTime(
      new Date(NOW.getTime() - 30 * 60 * 1000),
      "fr",
      NOW,
    );
    expect(out.toLowerCase()).toContain("il y a");
  });

  it("renders 'in N' for future in en", () => {
    const out = formatRelativeTime(
      new Date(NOW.getTime() + 2 * 86400 * 1000),
      "en",
      NOW,
    );
    expect(out.toLowerCase()).toMatch(/^in /);
    expect(out).toContain("2");
  });

  it("collapses sub-minute deltas to 'now' phrasing", () => {
    const out = formatRelativeTime(
      new Date(NOW.getTime() - 15 * 1000),
      "en",
      NOW,
    );
    // numeric: "auto" produces "now" / "right now" / "agora" etc.
    expect(out.toLowerCase()).toMatch(/now|seconds|0/);
  });

  it("picks the coarsest unit", () => {
    // 25 hours back should pick "day" not "hour"
    const out = formatRelativeTime(
      new Date(NOW.getTime() - 25 * 3600 * 1000),
      "en",
      NOW,
    );
    expect(out.toLowerCase()).toContain("day");
  });

  it("returns '—' for invalid dates", () => {
    expect(formatRelativeTime(new Date("invalid"), "en", NOW)).toBe("—");
  });
});

describe("formatter caching", () => {
  // Smoke test: formatters cache by (locale, options). Calling the
  // same format twice should hit the cache — covered indirectly by
  // assertion that repeated calls produce identical output and don't
  // throw under load.
  it("repeated calls are stable", () => {
    const a = formatNumber(1234.56, "fr");
    const b = formatNumber(1234.56, "fr");
    expect(a).toBe(b);
  });

  it("different options produce different output", () => {
    const noFrac = formatNumber(1234.5, "en", { maximumFractionDigits: 0 });
    const twoFrac = formatNumber(1234.5, "en", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    expect(noFrac).not.toBe(twoFrac);
  });
});
