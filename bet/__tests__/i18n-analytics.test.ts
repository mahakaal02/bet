import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import {
  LOCALES,
  TRACKING_PARAM_KEYS,
  appendTrackingParams,
  buildAuthRedirect,
  extractTrackingParams,
  localeAnalyticsContext,
  localeDimension,
  withPreservedParams,
} from "@/lib/i18n";

/**
 * Analytics-safety tests (PR-BET-I18N). Locks in that:
 *
 *   • Marketing-attribution state (UTM, click IDs, referral codes)
 *     survives every locale redirect / switch.
 *   • The tracking-param vocabulary contains the platforms we care
 *     about (so a click from a paid Meta ad keeps fbclid).
 *   • The locale-dimension helpers give analytics a stable handle
 *     to slice events by language.
 */

/* ============================================================
   Middleware preserves query state across redirects
   ============================================================ */

describe("middleware analytics safety — query preservation", () => {
  function locationOf(res: Response): string {
    const loc = res.headers.get("location");
    if (!loc) throw new Error("expected redirect");
    const u = new URL(loc);
    return u.pathname + u.search;
  }

  it("preserves a full UTM tag set through a geo redirect", () => {
    const res = middleware(
      new NextRequest(
        "https://kalki.local/wallet?utm_source=twitter&utm_medium=paid_social&utm_campaign=q2_launch&utm_content=variant_a&utm_term=prediction",
        { headers: { "x-vercel-ip-country": "BR" } },
      ),
    );
    const loc = locationOf(res);
    expect(loc.startsWith("/pt/wallet?")).toBe(true);
    expect(loc).toContain("utm_source=twitter");
    expect(loc).toContain("utm_medium=paid_social");
    expect(loc).toContain("utm_campaign=q2_launch");
    expect(loc).toContain("utm_content=variant_a");
    expect(loc).toContain("utm_term=prediction");
  });

  it("preserves Google Ads gclid", () => {
    const res = middleware(
      new NextRequest("https://kalki.local/markets?gclid=ABCDEFG-1234567890", {
        headers: { "x-vercel-ip-country": "FR" },
      }),
    );
    expect(locationOf(res)).toContain("gclid=ABCDEFG-1234567890");
  });

  it("preserves Meta fbclid + Microsoft msclkid", () => {
    const res = middleware(
      new NextRequest(
        "https://kalki.local/?fbclid=fb_click_42&msclkid=ms_click_99",
        { headers: { "accept-language": "es-MX,es;q=0.9" } },
      ),
    );
    const loc = locationOf(res);
    expect(loc).toContain("fbclid=fb_click_42");
    expect(loc).toContain("msclkid=ms_click_99");
  });

  it("preserves a referral code through the cookie-driven redirect", () => {
    const res = middleware(
      new NextRequest("https://kalki.local/register?ref=ALICE2024", {
        headers: { cookie: "preferred_language=pt" },
      }),
    );
    const loc = locationOf(res);
    expect(loc.startsWith("/pt/register")).toBe(true);
    expect(loc).toContain("ref=ALICE2024");
  });

  it("preserves cross-domain GA linker params (_ga, _gl)", () => {
    const res = middleware(
      new NextRequest("https://kalki.local/?_ga=GA1.2.1234.5678&_gl=1*foo*ga", {
        headers: { "accept-language": "fr-FR" },
      }),
    );
    const loc = locationOf(res);
    expect(loc).toContain("_ga=GA1.2.1234.5678");
    expect(loc).toContain("_gl=");
  });

  it("preserves params on the DEFAULT_LOCALE fallback path", () => {
    // No cookie, no AL, no geo — falls to default. Query still
    // survives because middleware clones the entire nextUrl.
    const res = middleware(
      new NextRequest("https://kalki.local/markets?utm_campaign=organic"),
    );
    expect(locationOf(res)).toContain("utm_campaign=organic");
  });

  it("preserves params on the bot redirect", () => {
    // Crawlers shouldn't be carrying UTM, but if they do (e.g. when
    // re-fetching a logged URL), still preserve so the analytics
    // pipeline sees an attributable bot-hit row rather than a
    // mysterious direct visit.
    const res = middleware(
      new NextRequest("https://kalki.local/?utm_source=newsletter", {
        headers: { "user-agent": "Googlebot/2.1" },
      }),
    );
    expect(locationOf(res)).toContain("utm_source=newsletter");
  });

  it("preserves a multi-value query (search filters + UTM together)", () => {
    const res = middleware(
      new NextRequest(
        "https://kalki.local/markets?q=elec&cat=POLITICS&sort=volume&utm_source=twitter",
        { headers: { "x-vercel-ip-country": "BR" } },
      ),
    );
    const loc = locationOf(res);
    expect(loc).toContain("q=elec");
    expect(loc).toContain("cat=POLITICS");
    expect(loc).toContain("sort=volume");
    expect(loc).toContain("utm_source=twitter");
  });
});

/* ============================================================
   Tracking-param vocabulary
   ============================================================ */

describe("TRACKING_PARAM_KEYS", () => {
  it("covers the full UTM family", () => {
    for (const k of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
    ]) {
      expect(TRACKING_PARAM_KEYS).toContain(k);
    }
  });

  it("covers major ad-network click IDs", () => {
    for (const k of [
      "gclid",
      "fbclid",
      "msclkid",
      "ttclid",
      "twclid",
      "yclid",
      "li_fat_id",
    ]) {
      expect(TRACKING_PARAM_KEYS).toContain(k);
    }
  });

  it("covers referral / sharing keys", () => {
    for (const k of ["ref", "referrer", "referral", "referral_code", "aff", "invite", "r"]) {
      expect(TRACKING_PARAM_KEYS).toContain(k);
    }
  });

  it("covers cross-domain session linkers (GA)", () => {
    expect(TRACKING_PARAM_KEYS).toContain("_ga");
    expect(TRACKING_PARAM_KEYS).toContain("_gl");
  });

  it("contains no duplicates", () => {
    expect(new Set(TRACKING_PARAM_KEYS).size).toBe(TRACKING_PARAM_KEYS.length);
  });

  it("is lowercase-normalized (URLSearchParams is case-sensitive)", () => {
    for (const k of TRACKING_PARAM_KEYS) {
      expect(k).toBe(k.toLowerCase());
    }
  });
});

/* ============================================================
   extractTrackingParams
   ============================================================ */

describe("extractTrackingParams", () => {
  it("returns an empty object for null/undefined input", () => {
    expect(extractTrackingParams(null)).toEqual({});
    expect(extractTrackingParams(undefined)).toEqual({});
  });

  it("returns an empty object when no known keys are present", () => {
    const sp = new URLSearchParams("q=foo&sort=desc");
    expect(extractTrackingParams(sp)).toEqual({});
  });

  it("extracts the UTM subset from URLSearchParams", () => {
    const sp = new URLSearchParams(
      "utm_source=twitter&utm_medium=paid&utm_campaign=launch&q=foo",
    );
    expect(extractTrackingParams(sp)).toEqual({
      utm_source: "twitter",
      utm_medium: "paid",
      utm_campaign: "launch",
    });
    // Non-tracking key NOT included.
    expect(extractTrackingParams(sp).q).toBeUndefined();
  });

  it("works with a plain Record (Next.js searchParams shape)", () => {
    const out = extractTrackingParams({
      utm_source: "newsletter",
      fbclid: "fb42",
      q: "ignored",
    });
    expect(out).toEqual({ utm_source: "newsletter", fbclid: "fb42" });
  });

  it("picks the first value when the Record has arrays (Next.js variant)", () => {
    const out = extractTrackingParams({
      utm_source: ["twitter", "reddit"],
      ref: "alice",
    });
    expect(out).toEqual({ utm_source: "twitter", ref: "alice" });
  });

  it("drops empty-string values", () => {
    const sp = new URLSearchParams("utm_source=&utm_medium=email");
    expect(extractTrackingParams(sp)).toEqual({ utm_medium: "email" });
  });
});

/* ============================================================
   appendTrackingParams / withPreservedParams
   ============================================================ */

describe("appendTrackingParams", () => {
  it("returns the original path when there are no params", () => {
    expect(appendTrackingParams("/en/wallet", {})).toBe("/en/wallet");
  });

  it("appends a single UTM param", () => {
    expect(appendTrackingParams("/en/wallet", { utm_source: "twitter" })).toBe(
      "/en/wallet?utm_source=twitter",
    );
  });

  it("merges into an existing query string", () => {
    const out = appendTrackingParams("/en/markets?q=foo", {
      utm_source: "twitter",
    });
    expect(out).toContain("q=foo");
    expect(out).toContain("utm_source=twitter");
    expect(out.startsWith("/en/markets?")).toBe(true);
  });

  it("target values win on key conflicts (idempotent)", () => {
    const out = appendTrackingParams("/en/?utm_id=newest", {
      utm_id: "old",
    });
    expect(out).toBe("/en/?utm_id=newest");
  });
});

describe("withPreservedParams", () => {
  it("returns the bare path when source params are empty", () => {
    expect(withPreservedParams("/en/wallet", new URLSearchParams())).toBe(
      "/en/wallet",
    );
    expect(withPreservedParams("/en/wallet", null)).toBe("/en/wallet");
  });

  it("appends every source key onto the target", () => {
    const sp = new URLSearchParams("utm_source=twitter&ref=alice&q=foo");
    const out = withPreservedParams("/en/markets", sp);
    expect(out).toContain("utm_source=twitter");
    expect(out).toContain("ref=alice");
    expect(out).toContain("q=foo");
  });

  it("merges with an existing query on the target (target wins on conflict)", () => {
    const sp = new URLSearchParams("locale=en&q=oldQ");
    const out = withPreservedParams("/en/markets?q=newQ", sp);
    expect(out).toContain("q=newQ");
    expect(out).not.toContain("q=oldQ");
    expect(out).toContain("locale=en");
  });

  it("models the switcher hot path — UTM survives locale swap", () => {
    // User on /pt/wallet?utm_campaign=launch&utm_source=twitter
    // clicks English in the switcher. The switcher computes:
    //   localizedPath("/pt/wallet", "en") → "/en/wallet"
    // then calls withPreservedParams("/en/wallet", searchParams).
    const sp = new URLSearchParams(
      "utm_campaign=launch&utm_source=twitter&fbclid=ABC",
    );
    const out = withPreservedParams("/en/wallet", sp);
    expect(out).toContain("/en/wallet");
    expect(out).toContain("utm_campaign=launch");
    expect(out).toContain("utm_source=twitter");
    expect(out).toContain("fbclid=ABC");
  });

  describe("hash fragment preservation", () => {
    it("appends the hash when no params present", () => {
      expect(withPreservedParams("/en/markets", null, "#comments")).toBe(
        "/en/markets#comments",
      );
    });

    it("appends the hash after the query string", () => {
      const sp = new URLSearchParams("q=foo");
      expect(withPreservedParams("/en/markets", sp, "#latest")).toBe(
        "/en/markets?q=foo#latest",
      );
    });

    it("normalizes a hash that lacks the leading '#'", () => {
      const sp = new URLSearchParams("q=foo");
      expect(withPreservedParams("/en/markets", sp, "comments")).toBe(
        "/en/markets?q=foo#comments",
      );
    });

    it("skips an empty/undefined hash", () => {
      expect(withPreservedParams("/en/markets", null, "")).toBe("/en/markets");
      expect(withPreservedParams("/en/markets", null, undefined)).toBe(
        "/en/markets",
      );
      expect(withPreservedParams("/en/markets", null, null)).toBe("/en/markets");
    });

    it("preserves hash when target already has a query", () => {
      const sp = new URLSearchParams("locale=en");
      expect(withPreservedParams("/en/markets?q=foo", sp, "#sec")).toBe(
        "/en/markets?q=foo&locale=en#sec",
      );
    });
  });
});

/* ============================================================
   buildAuthRedirect — UTM preservation through the auth round-trip
   ============================================================ */

describe("buildAuthRedirect", () => {
  it("builds a locale-prefixed login URL with the bare target", () => {
    const out = buildAuthRedirect("/wallet", {}, "pt");
    expect(out).toBe("/pt/login?next=" + encodeURIComponent("/pt/wallet"));
  });

  it("preserves UTM params through the auth round-trip", () => {
    const out = buildAuthRedirect(
      "/wallet",
      { utm_source: "twitter", utm_campaign: "launch" },
      "pt",
    );
    // The `next=` value is the URL-encoded full inbound URL so that
    // LoginForm can read it via useSearchParams and router.replace
    // straight there.
    expect(out.startsWith("/pt/login?next=")).toBe(true);
    const next = decodeURIComponent(out.split("next=")[1]);
    expect(next).toBe("/pt/wallet?utm_source=twitter&utm_campaign=launch");
  });

  it("preserves click IDs (fbclid, gclid, msclkid)", () => {
    const out = buildAuthRedirect(
      "/portfolio",
      { fbclid: "fb42", gclid: "g-abc", msclkid: "ms99" },
      "es",
    );
    const next = decodeURIComponent(out.split("next=")[1]);
    expect(next).toContain("fbclid=fb42");
    expect(next).toContain("gclid=g-abc");
    expect(next).toContain("msclkid=ms99");
  });

  it("preserves referral codes through the auth round-trip", () => {
    const out = buildAuthRedirect(
      "/wallet",
      { ref: "alice-2024", invite: "BETA42" },
      "fr",
    );
    const next = decodeURIComponent(out.split("next=")[1]);
    expect(next).toContain("ref=alice-2024");
    expect(next).toContain("invite=BETA42");
  });

  it("handles the Next.js array-shape searchParams (picks first value)", () => {
    const out = buildAuthRedirect(
      "/notifications",
      {
        utm_source: ["newsletter", "duplicate"],
        ref: "alice",
      },
      "en",
    );
    const next = decodeURIComponent(out.split("next=")[1]);
    expect(next).toContain("utm_source=newsletter");
    expect(next).not.toContain("duplicate");
    expect(next).toContain("ref=alice");
  });

  it("drops empty / undefined params (no junk in URL)", () => {
    const out = buildAuthRedirect(
      "/wallet",
      {
        utm_source: "",
        utm_medium: undefined,
        ref: "alice",
      },
      "pt",
    );
    const next = decodeURIComponent(out.split("next=")[1]);
    expect(next).toContain("ref=alice");
    expect(next).not.toContain("utm_source=");
    expect(next).not.toContain("utm_medium=");
  });

  it("works with URLSearchParams input shape", () => {
    const sp = new URLSearchParams("utm_source=twitter&ref=alice");
    const out = buildAuthRedirect("/wallet", sp, "pt");
    const next = decodeURIComponent(out.split("next=")[1]);
    expect(next).toContain("utm_source=twitter");
    expect(next).toContain("ref=alice");
  });

  it("supports a custom loginPath (e.g. /sso vs /login)", () => {
    const out = buildAuthRedirect("/wallet", {}, "pt", "/sso");
    expect(out.startsWith("/pt/sso?next=")).toBe(true);
  });

  it("handles bare params (no params at all)", () => {
    expect(buildAuthRedirect("/wallet", null, "en")).toBe(
      "/en/login?next=" + encodeURIComponent("/en/wallet"),
    );
    expect(buildAuthRedirect("/wallet", undefined, "en")).toBe(
      "/en/login?next=" + encodeURIComponent("/en/wallet"),
    );
  });

  it("the `next=` target is double-encoded-safe (decode roundtrips)", () => {
    const out = buildAuthRedirect(
      "/wallet",
      { utm_campaign: "Q2 Launch (Final)" },
      "pt",
    );
    const next = decodeURIComponent(out.split("next=")[1]);
    // The inner param value with a space + parens roundtrips intact.
    expect(next).toContain("utm_campaign=Q2+Launch+%28Final%29");
  });
});

/* ============================================================
   Locale dimension helpers
   ============================================================ */

describe("localeDimension", () => {
  it("returns the bare locale code for analytics tagging", () => {
    expect(localeDimension("en")).toBe("en");
    expect(localeDimension("pt")).toBe("pt");
    expect(localeDimension("es")).toBe("es");
    expect(localeDimension("fr")).toBe("fr");
  });
});

describe("localeAnalyticsContext", () => {
  it("returns locale + IETF language tag + direction", () => {
    expect(localeAnalyticsContext("en")).toEqual({
      locale: "en",
      language: "en-US",
      dir: "ltr",
    });
    expect(localeAnalyticsContext("pt")).toEqual({
      locale: "pt",
      language: "pt-BR",
      dir: "ltr",
    });
    expect(localeAnalyticsContext("es")).toEqual({
      locale: "es",
      language: "es-ES",
      dir: "ltr",
    });
    expect(localeAnalyticsContext("fr")).toEqual({
      locale: "fr",
      language: "fr-FR",
      dir: "ltr",
    });
  });

  it("covers every supported locale", () => {
    for (const locale of LOCALES) {
      const ctx = localeAnalyticsContext(locale);
      expect(ctx.locale).toBe(locale);
      expect(ctx.language.length).toBeGreaterThan(0);
      expect(["ltr", "rtl"]).toContain(ctx.dir);
    }
  });
});
