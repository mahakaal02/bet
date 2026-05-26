import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALES,
  RTL_LOCALES,
  dirForLocale,
} from "@/lib/i18n";

/**
 * Direction resolution + RTL set sanity checks (PR-BET-I18N).
 *
 * `dirForLocale()` is what the root layout calls to emit `<html dir>`.
 * When an RTL locale is eventually added (e.g. "ar", "he") the test
 * suite picks it up automatically by virtue of running the same
 * helper — no need to update fixtures.
 */
describe("dirForLocale", () => {
  it("returns 'ltr' for every currently-shipped locale", () => {
    for (const locale of LOCALES) {
      expect(dirForLocale(locale)).toBe("ltr");
    }
  });

  it("returns 'ltr' for the default locale", () => {
    expect(dirForLocale(DEFAULT_LOCALE)).toBe("ltr");
  });

  it("returns 'rtl' for any locale that lives in RTL_LOCALES", () => {
    // We don't ship RTL locales yet, but the helper must still treat
    // an entry of the set as RTL — exercise the path directly so
    // adding "ar" / "he" later doesn't silently regress.
    for (const rtl of RTL_LOCALES) {
      expect(dirForLocale(rtl)).toBe("rtl");
    }
  });

  it("treats arbitrary unknown locales as LTR (safe default)", () => {
    expect(dirForLocale("zh")).toBe("ltr");
    expect(dirForLocale("ja")).toBe("ltr");
    expect(dirForLocale("xx")).toBe("ltr");
  });
});

describe("RTL_LOCALES", () => {
  it("does not currently include any shipped locale (the four we support are LTR)", () => {
    for (const locale of LOCALES) {
      expect(RTL_LOCALES.has(locale)).toBe(false);
    }
  });

  it("is a Set (so .has lookups are O(1))", () => {
    expect(RTL_LOCALES).toBeInstanceOf(Set);
  });
});
