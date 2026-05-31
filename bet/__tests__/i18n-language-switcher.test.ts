import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_DISPLAY,
  PREFERRED_LOCALE_COOKIE,
  PREFERRED_LOCALE_COOKIE_MAX_AGE_SECONDS,
  localizedPath,
  splitLocaleFromPath,
  isLocale,
} from "@/lib/i18n";

/**
 * Language-switcher tests (PR-BET-I18N).
 *
 * The switcher itself is a React client component; the existing
 * vitest stack is node-environment + pure functions (no
 * @testing-library/react, no JSDOM). Instead of bolting on a second
 * test environment for one component, we validate the contract the
 * switcher relies on:
 *
 *   1. The path-rewriting helpers (`localizedPath`,
 *      `splitLocaleFromPath`) — the switcher uses these to preserve
 *      the user's current page when swapping locales.
 *   2. The preferred_language cookie format — the switcher writes
 *      this cookie; the middleware reads it. Tests below verify
 *      that the cookie name / max-age / value contract works end-
 *      to-end: a request with the cookie set by the switcher is
 *      respected by the middleware on the next visit.
 *   3. Display-name lookup — `LOCALE_DISPLAY` covers every locale
 *      and uses native spellings so users find their language
 *      regardless of which one the page currently renders in.
 */

describe("LanguageSwitcher contract — path rewriting", () => {
  describe("localizedPath", () => {
    it("prepends the locale to a non-localized path", () => {
      expect(localizedPath("/markets", "pt")).toBe("/pt/markets");
      expect(localizedPath("/wallet/withdraw", "fr")).toBe("/fr/wallet/withdraw");
    });

    it("replaces an existing locale prefix rather than nesting", () => {
      // The switcher calls localizedPath(currentPath, nextLocale) —
      // when the current path already has /en/, switching to pt must
      // produce /pt/, not /pt/en/.
      expect(localizedPath("/en/markets", "pt")).toBe("/pt/markets");
      expect(localizedPath("/fr/wallet", "es")).toBe("/es/wallet");
    });

    it("handles the locale root", () => {
      expect(localizedPath("/", "pt")).toBe("/pt");
      expect(localizedPath("/en", "fr")).toBe("/fr");
    });

    it("is idempotent (path already at the target locale)", () => {
      expect(localizedPath("/pt/markets", "pt")).toBe("/pt/markets");
    });

    it("preserves deep paths", () => {
      expect(localizedPath("/en/markets/super-bowl-winner-2027", "fr")).toBe(
        "/fr/markets/super-bowl-winner-2027",
      );
    });
  });

  describe("splitLocaleFromPath", () => {
    it("extracts the locale from a prefixed path", () => {
      expect(splitLocaleFromPath("/pt/wallet")).toEqual({
        locale: "pt",
        rest: "/wallet",
      });
    });

    it("returns null locale when no prefix matches", () => {
      expect(splitLocaleFromPath("/wallet")).toEqual({
        locale: null,
        rest: "/wallet",
      });
    });

    it("handles the bare locale root", () => {
      expect(splitLocaleFromPath("/en")).toEqual({
        locale: "en",
        rest: "/",
      });
    });

    it("handles the absolute root", () => {
      expect(splitLocaleFromPath("/")).toEqual({
        locale: null,
        rest: "/",
      });
    });

    it("does NOT match an unsupported locale code as a prefix", () => {
      // /zh/ isn't a valid locale → treat the whole thing as path.
      expect(splitLocaleFromPath("/zh/wallet")).toEqual({
        locale: null,
        rest: "/zh/wallet",
      });
    });
  });
});

describe("LanguageSwitcher contract — display catalogue", () => {
  it("covers every locale", () => {
    for (const locale of LOCALES) {
      expect(LOCALE_DISPLAY[locale]).toBeDefined();
      expect(LOCALE_DISPLAY[locale].length).toBeGreaterThan(0);
    }
  });

  it("uses native spellings (not English glosses)", () => {
    // The switcher shows users their own language in its own script —
    // they recognise "Português" / "Español" / "Français" even when
    // the page renders in another locale. English glosses defeat
    // the purpose.
    expect(LOCALE_DISPLAY.pt).toBe("Português");
    expect(LOCALE_DISPLAY.es).toBe("Español");
    expect(LOCALE_DISPLAY.fr).toBe("Français");
    expect(LOCALE_DISPLAY.en).toBe("English");
  });

  it("returns unique display names per locale", () => {
    const names = Object.values(LOCALE_DISPLAY);
    expect(new Set(names).size).toBe(names.length);
  });
});

/* ============================================================
   Persistence — the switcher writes a cookie; middleware reads it
   ============================================================ */

describe("LanguageSwitcher contract — preferred_language cookie", () => {
  it("cookie name is the public constant the middleware reads", () => {
    expect(PREFERRED_LOCALE_COOKIE).toBe("preferred_language");
  });

  it("cookie TTL is one year (the switcher writes this max-age)", () => {
    const oneYear = 365 * 24 * 60 * 60;
    expect(PREFERRED_LOCALE_COOKIE_MAX_AGE_SECONDS).toBe(oneYear);
  });

  it("a cookie value the switcher would write must round-trip through isLocale", () => {
    // The switcher only ever passes a value from LOCALES; verify they
    // all survive the middleware's isLocale type-guard. Catches the
    // case where someone renames a locale code in one file and not
    // the other.
    for (const locale of LOCALES) {
      expect(isLocale(locale)).toBe(true);
    }
  });

  it("the cookie the switcher writes is honored by middleware on next visit", () => {
    // Simulate the moment after the user clicks Spanish in the
    // switcher: a redirect happens client-side via router.push, AND
    // the preferred_language=es cookie is set. The next non-localized
    // request hits middleware which must respect it.
    const req = new NextRequest("https://kalki.bet/wallet", {
      headers: { cookie: `${PREFERRED_LOCALE_COOKIE}=es` },
    });
    const res = middleware(req);
    const location = res.headers.get("location");
    expect(location).not.toBeNull();
    expect(new URL(location!).pathname).toBe("/es/wallet");
  });

  it("an unsupported value in the cookie is ignored (defends against tampering)", () => {
    // If a user (or a curl script) sets the cookie to a junk value,
    // middleware must fall through to the next priority step, not
    // honor the junk.
    const req = new NextRequest("https://kalki.bet/wallet", {
      headers: { cookie: `${PREFERRED_LOCALE_COOKIE}=" or 1=1"` },
    });
    const res = middleware(req);
    // No AL, no geo → default fallback.
    expect(new URL(res.headers.get("location")!).pathname).toBe(
      `/${DEFAULT_LOCALE}/wallet`,
    );
  });

  it("switching to the same locale as the current path doesn't break round-trip", () => {
    // User is on /pt/wallet; switcher click on Português should be a
    // no-op redirect (back to /pt/wallet). The middleware passes
    // through any locale-prefixed URL.
    const req = new NextRequest("https://kalki.bet/pt/wallet", {
      headers: { cookie: `${PREFERRED_LOCALE_COOKIE}=pt` },
    });
    const res = middleware(req);
    // Pass-through — no redirect.
    expect(res.headers.get("location")).toBeNull();
  });
});

/* ============================================================
   End-to-end persistence simulation
   ============================================================ */

describe("LanguageSwitcher contract — persistence over a session", () => {
  it("first-visit geo → user switches → subsequent visits honor the choice", () => {
    // 1) First visit: bare /, geo BR → middleware redirects to /pt.
    let req = new NextRequest("https://kalki.bet/", {
      headers: { "x-vercel-ip-country": "BR" },
    });
    let res = middleware(req);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/pt");
    // Sentinel cookie was stamped — but no preferred_language cookie
    // yet (the switcher hasn't been used).
    expect(res.cookies.get(PREFERRED_LOCALE_COOKIE)).toBeUndefined();

    // 2) User browses to /pt/wallet (browser follows the redirect).
    //    Then they click "English" in the switcher. The switcher
    //    writes preferred_language=en and router.push("/en/wallet").
    //    The next bare-path navigation tests persistence.
    req = new NextRequest("https://kalki.bet/wallet", {
      headers: {
        cookie: `${PREFERRED_LOCALE_COOKIE}=en; kalki_geo_routed=1`,
        "x-vercel-ip-country": "BR", // geo still says BR — irrelevant now
      },
    });
    res = middleware(req);
    // Cookie beats geo — user lands on /en/markets, not /pt/markets.
    expect(new URL(res.headers.get("location")!).pathname).toBe("/en/wallet");
  });

  it("manual choice survives a VPN-induced country change", () => {
    // User normally in France (geo FR → fr). They've set
    // preferred_language=en (English-only mode). VPN puts them in
    // Brazil — geo says BR. The cookie wins.
    const req = new NextRequest("https://kalki.bet/wallet", {
      headers: {
        cookie: `${PREFERRED_LOCALE_COOKIE}=en`,
        "x-vercel-ip-country": "BR",
      },
    });
    const res = middleware(req);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/en/wallet");
  });
});
