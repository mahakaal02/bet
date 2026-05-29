import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import {
  DEFAULT_LOCALE,
  GEO_ROUTED_COOKIE,
  LOCALE_HEADER,
  PREFERRED_LOCALE_COOKIE,
} from "@/lib/i18n";

/**
 * Production-grade middleware integration tests (PR-BET-I18N).
 *
 * Strategy: black-box exercise the middleware function with crafted
 * `NextRequest` objects and assert on the `NextResponse` it returns —
 * status code, Location header, set-cookies, and the resolved
 * `x-bet-locale` request header for pass-through cases.
 *
 * Why integration-style here vs. mocking dependencies? The middleware
 * is the SEAM between the URL space and every page; testing it in
 * isolation against fake helpers would lock in implementation
 * details. Hitting the real `parseAcceptLanguage` / `localeForCountry`
 * / `isLocale` is what guarantees the priority chain behaves as
 * advertised in the README.
 */

interface ReqOpts {
  cookies?: Record<string, string>;
  acceptLanguage?: string;
  /** Country code for the edge-geo header. */
  country?: string;
  userAgent?: string;
  /** Extra raw headers to set verbatim. */
  extra?: Record<string, string>;
}

/**
 * Build a `NextRequest` with the headers / cookies the i18n middleware
 * actually reads. Defaults to a benign desktop Chrome UA so we don't
 * accidentally match the bot heuristic.
 */
function makeRequest(url: string, opts: ReqOpts = {}): NextRequest {
  const headers = new Headers();
  if (opts.cookies && Object.keys(opts.cookies).length > 0) {
    headers.set(
      "cookie",
      Object.entries(opts.cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
    );
  }
  if (opts.acceptLanguage) headers.set("accept-language", opts.acceptLanguage);
  if (opts.country) headers.set("x-vercel-ip-country", opts.country);
  headers.set(
    "user-agent",
    opts.userAgent ??
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  );
  if (opts.extra) {
    for (const [k, v] of Object.entries(opts.extra)) headers.set(k, v);
  }
  return new NextRequest(url, { headers });
}

/** Helper: extract the Location header from a redirect response. */
function locationOf(res: Response): string {
  const loc = res.headers.get("location");
  if (!loc) throw new Error("expected a Location header on response");
  // The redirect URL is absolute; reduce to path for easier assertions.
  return new URL(loc).pathname + new URL(loc).search;
}

/* ============================================================
   1. Explicit URL — top-priority pass-through
   ============================================================ */

describe("middleware: priority 1 — explicit URL", () => {
  it("passes through a path that already carries a locale prefix", () => {
    const res = middleware(makeRequest("https://kalki.local/en/wallet"));
    // NextResponse.next() returns a non-redirect response.
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("stamps the x-bet-locale header on pass-through so the root layout knows the locale", () => {
    const res = middleware(makeRequest("https://kalki.local/pt/wallet"));
    // The middleware forwards the locale to the layout via
    // `NextResponse.next({ request: { headers } })`. Next.js encodes
    // those request-header overrides in the `x-middleware-override-headers`
    // response header (comma-separated list of header names) plus one
    // `x-middleware-request-<name>` header per overridden field.
    const overridden = res.headers.get("x-middleware-override-headers");
    expect(overridden).not.toBeNull();
    expect(overridden!.split(",")).toContain(LOCALE_HEADER);
    expect(res.headers.get(`x-middleware-request-${LOCALE_HEADER}`)).toBe(
      "pt",
    );
  });

  it("does not overwrite the preferred_language cookie when path already has a locale", () => {
    const res = middleware(
      makeRequest("https://kalki.local/en/markets", {
        cookies: { [PREFERRED_LOCALE_COOKIE]: "pt" },
      }),
    );
    // Pass-through must not touch cookies — manual choice (/en/) is
    // the user's explicit per-page intent; we don't downgrade it to a
    // persistent preference.
    expect(res.cookies.get(PREFERRED_LOCALE_COOKIE)).toBeUndefined();
  });

  it("passes through every supported locale prefix", () => {
    // Use a content path, NOT the bare locale root: PR-HUB-TO-MARKETS
    // special-cases `/{locale}/` to redirect to the markets list (see
    // the dedicated test below), so the root is no longer a pass-through.
    // A deep path exercises the locale-agnostic pass-through this test
    // is actually guarding.
    for (const loc of ["en", "pt", "es", "fr"] as const) {
      const res = middleware(makeRequest(`https://kalki.local/${loc}/markets`));
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("redirects the bare locale root to the markets list (PR-HUB-TO-MARKETS)", () => {
    // The locale root no longer hosts a marketing landing page; the hub
    // sends `/{locale}` straight to tradable content in one hop.
    for (const loc of ["en", "pt", "es", "fr"] as const) {
      const res = middleware(makeRequest(`https://kalki.local/${loc}/`));
      // NextURL serializes the cloned redirect with a trailing slash
      // (`/en/markets/`); accept it with or without, since the intent is
      // simply "locale root → markets list for this locale".
      expect(locationOf(res)).toMatch(new RegExp(`^/${loc}/markets/?$`));
    }
  });
});

/* ============================================================
   2. preferred_language cookie — manual choice always wins
   ============================================================ */

describe("middleware: priority 2 — preferred_language cookie", () => {
  it("redirects a non-localized path to the cookie's locale", () => {
    const res = middleware(
      makeRequest("https://kalki.local/wallet", {
        cookies: { [PREFERRED_LOCALE_COOKIE]: "pt" },
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(locationOf(res)).toBe("/pt/wallet");
  });

  it("cookie beats Accept-Language", () => {
    // AL says fr; cookie says es → cookie wins.
    const res = middleware(
      makeRequest("https://kalki.local/markets", {
        cookies: { [PREFERRED_LOCALE_COOKIE]: "es" },
        acceptLanguage: "fr-CA,fr;q=0.9",
      }),
    );
    expect(locationOf(res)).toBe("/es/markets");
  });

  it("cookie beats Geo-IP", () => {
    // Geo says BR (→ pt); cookie says en → cookie wins.
    const res = middleware(
      makeRequest("https://kalki.local/", {
        cookies: { [PREFERRED_LOCALE_COOKIE]: "en" },
        country: "BR",
      }),
    );
    expect(locationOf(res)).toBe("/en");
  });

  it("ignores cookie set to an unsupported locale (falls through to next step)", () => {
    // zh is not a supported locale — the cookie is treated as unset.
    const res = middleware(
      makeRequest("https://kalki.local/wallet", {
        cookies: { [PREFERRED_LOCALE_COOKIE]: "zh" },
        country: "FR",
      }),
    );
    // Geo would route FR → fr. Step 3 (Accept-Language) is empty, so
    // step 4 (geo) wins.
    expect(locationOf(res)).toBe("/fr/wallet");
  });
});

/* ============================================================
   3. Accept-Language — beats Geo-IP per W3C best practice
   ============================================================ */

describe("middleware: priority 3 — Accept-Language", () => {
  it("redirects to the first supported AL match", () => {
    const res = middleware(
      makeRequest("https://kalki.local/markets", {
        acceptLanguage: "fr-CA,fr;q=0.9,en;q=0.5",
      }),
    );
    expect(locationOf(res)).toBe("/fr/markets");
  });

  it("Accept-Language beats Geo-IP", () => {
    // A French traveller in Brazil — AL=fr wins over geo=BR.
    const res = middleware(
      makeRequest("https://kalki.local/markets", {
        acceptLanguage: "fr-FR,fr;q=0.9",
        country: "BR",
      }),
    );
    expect(locationOf(res)).toBe("/fr/markets");
  });

  it("falls through when AL only advertises unsupported languages", () => {
    // Chinese-only AL — no match. With no geo, defaults to en.
    const res = middleware(
      makeRequest("https://kalki.local/wallet", {
        acceptLanguage: "zh-CN,ja;q=0.9",
      }),
    );
    expect(locationOf(res)).toBe(`/${DEFAULT_LOCALE}/wallet`);
  });

  it("respects q=0 rejections in AL", () => {
    // en explicitly rejected, fr at 0.9 → fr wins.
    const res = middleware(
      makeRequest("https://kalki.local/", {
        acceptLanguage: "en;q=0,fr;q=0.9",
      }),
    );
    expect(locationOf(res)).toBe("/fr");
  });
});

/* ============================================================
   4. Geo-IP — fires only when AL gave nothing
   ============================================================ */

describe("middleware: priority 4 — Geo-IP", () => {
  it("uses Geo-IP when no AL and no cookie", () => {
    const res = middleware(
      makeRequest("https://kalki.local/markets", { country: "BR" }),
    );
    expect(locationOf(res)).toBe("/pt/markets");
  });

  it("supports the cf-ipcountry header alias", () => {
    const res = middleware(
      makeRequest("https://kalki.local/", {
        extra: { "cf-ipcountry": "MX" },
      }),
    );
    expect(locationOf(res)).toBe("/es");
  });

  it("supports the x-real-country header alias", () => {
    const res = middleware(
      makeRequest("https://kalki.local/", {
        extra: { "x-real-country": "FR" },
      }),
    );
    expect(locationOf(res)).toBe("/fr");
  });

  it("falls back to DEFAULT_LOCALE for unmapped countries", () => {
    const res = middleware(
      makeRequest("https://kalki.local/", { country: "ZZ" }),
    );
    expect(locationOf(res)).toBe(`/${DEFAULT_LOCALE}`);
  });

  it("stamps the geo-routed sentinel cookie when geo fires", () => {
    const res = middleware(
      makeRequest("https://kalki.local/", { country: "BR" }),
    );
    const sentinel = res.cookies.get(GEO_ROUTED_COOKIE);
    expect(sentinel?.value).toBe("1");
    expect(sentinel?.httpOnly).toBe(true);
    expect(sentinel?.sameSite).toBe("lax");
    expect(sentinel?.path).toBe("/");
  });

  it("does NOT re-geo-route a visitor whose sentinel is set", () => {
    // Visitor has the sentinel from a prior visit, no other signals.
    // Without the sentinel guard, geo (BR) would keep firing on every
    // request and override their intentional /en/ navigation.
    const res = middleware(
      makeRequest("https://kalki.local/wallet", {
        cookies: { [GEO_ROUTED_COOKIE]: "1" },
        country: "BR",
      }),
    );
    // Sentinel set, no AL, no cookie → fall through to DEFAULT_LOCALE.
    expect(locationOf(res)).toBe(`/${DEFAULT_LOCALE}/wallet`);
  });
});

/* ============================================================
   5. DEFAULT_LOCALE fallback
   ============================================================ */

describe("middleware: priority 5 — default fallback", () => {
  it("uses DEFAULT_LOCALE when nothing else matches", () => {
    const res = middleware(makeRequest("https://kalki.local/markets"));
    expect(locationOf(res)).toBe(`/${DEFAULT_LOCALE}/markets`);
  });

  it("preserves the query string on fall-through", () => {
    const res = middleware(
      makeRequest("https://kalki.local/markets?q=elec&cat=POLITICS"),
    );
    expect(locationOf(res)).toBe(`/${DEFAULT_LOCALE}/markets?q=elec&cat=POLITICS`);
  });

  it("normalizes / to /{DEFAULT_LOCALE}", () => {
    const res = middleware(makeRequest("https://kalki.local/"));
    expect(locationOf(res)).toBe(`/${DEFAULT_LOCALE}`);
  });
});

/* ============================================================
   6. Bot handling
   ============================================================ */

describe("middleware: bot handling", () => {
  const bots = [
    "Googlebot/2.1 (+http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "Mozilla/5.0 (compatible; DuckDuckBot-Https/1.1; https://duckduckgo.com/duckduckbot)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Mozilla/5.0 (compatible; YandexBot/3.0)",
    "Twitterbot/1.0",
    "WhatsApp/2.21.4.18",
    "LinkedInBot/1.0 (compatible; Mozilla/5.0)",
  ];

  for (const ua of bots) {
    it(`redirects bot "${ua.split("/")[0]}" to DEFAULT_LOCALE`, () => {
      const res = middleware(
        makeRequest("https://kalki.local/markets", { userAgent: ua }),
      );
      expect(locationOf(res)).toBe(`/${DEFAULT_LOCALE}/markets`);
    });
  }

  it("bots never set the preferred_language cookie", () => {
    const res = middleware(
      makeRequest("https://kalki.local/markets", {
        userAgent: "Googlebot/2.1",
        country: "BR", // would otherwise have geo'd to pt
      }),
    );
    expect(res.cookies.get(PREFERRED_LOCALE_COOKIE)).toBeUndefined();
  });

  it("bots never set the geo-routed sentinel", () => {
    const res = middleware(
      makeRequest("https://kalki.local/", {
        userAgent: "Googlebot/2.1",
        country: "BR",
      }),
    );
    expect(res.cookies.get(GEO_ROUTED_COOKIE)).toBeUndefined();
  });

  it("bots ignore the user's cookie too (canonical index hygiene)", () => {
    // Even if a cookie says pt, a bot's request goes to DEFAULT_LOCALE
    // so the index keys off the canonical URL.
    const res = middleware(
      makeRequest("https://kalki.local/", {
        userAgent: "Googlebot/2.1",
        cookies: { [PREFERRED_LOCALE_COOKIE]: "pt" },
      }),
    );
    expect(locationOf(res)).toBe(`/${DEFAULT_LOCALE}`);
  });
});

/* ============================================================
   7. Carve-outs (non-localized paths)
   ============================================================ */

describe("middleware: carve-outs", () => {
  it("passes /share/* through unchanged (server-rendered share previews)", () => {
    const res = middleware(makeRequest("https://kalki.local/share/auction-42"));
    expect(res.headers.get("location")).toBeNull();
  });

  // /api/* and /admin/* are excluded by the middleware matcher config
  // before the function ever runs. Tests for those would have to load
  // Next.js's matcher engine; we trust the config and verify in CI by
  // running the actual app.
});

/* ============================================================
   8. No redirect loops — the cornerstone invariant
   ============================================================ */

describe("middleware: no redirect loops", () => {
  it("does not redirect a URL it just redirected to", () => {
    // Step 1: bare /wallet with geo BR → redirects to /pt/wallet.
    const first = middleware(
      makeRequest("https://kalki.local/wallet", { country: "BR" }),
    );
    expect(locationOf(first)).toBe("/pt/wallet");

    // Step 2: the browser follows the redirect and makes a request to
    // /pt/wallet. Middleware should see the locale prefix and pass
    // through — no second redirect.
    const second = middleware(
      makeRequest("https://kalki.local/pt/wallet", { country: "BR" }),
    );
    expect(second.headers.get("location")).toBeNull();
  });

  it("does not loop when AL drives the redirect", () => {
    const first = middleware(
      makeRequest("https://kalki.local/markets", {
        acceptLanguage: "fr-FR,fr;q=0.9",
      }),
    );
    expect(locationOf(first)).toBe("/fr/markets");

    // Follow the redirect — same AL on the next request.
    const second = middleware(
      makeRequest("https://kalki.local/fr/markets", {
        acceptLanguage: "fr-FR,fr;q=0.9",
      }),
    );
    expect(second.headers.get("location")).toBeNull();
  });

  it("does not loop when the cookie drives the redirect", () => {
    const first = middleware(
      makeRequest("https://kalki.local/wallet", {
        cookies: { [PREFERRED_LOCALE_COOKIE]: "es" },
      }),
    );
    expect(locationOf(first)).toBe("/es/wallet");

    const second = middleware(
      makeRequest("https://kalki.local/es/wallet", {
        cookies: { [PREFERRED_LOCALE_COOKIE]: "es" },
      }),
    );
    expect(second.headers.get("location")).toBeNull();
  });

  it("sentinel + locale-prefix combination doesn't re-geo on revisit", () => {
    // User was geo-routed once (sentinel set), then later visits a
    // locale-prefixed URL. The sentinel is irrelevant because the URL
    // already declares the locale.
    const res = middleware(
      makeRequest("https://kalki.local/en/wallet", {
        cookies: { [GEO_ROUTED_COOKIE]: "1" },
        country: "BR",
      }),
    );
    expect(res.headers.get("location")).toBeNull();
  });
});

/* ============================================================
   9. Locale persistence — sentinel + cookie behaviour over time
   ============================================================ */

describe("middleware: locale persistence", () => {
  it("first geo redirect sets the sentinel; second visit honors it", () => {
    // 1st visit — no cookies, geo from BR.
    const first = middleware(
      makeRequest("https://kalki.local/", { country: "BR" }),
    );
    expect(locationOf(first)).toBe("/pt");
    const sentinel = first.cookies.get(GEO_ROUTED_COOKIE);
    expect(sentinel?.value).toBe("1");

    // 2nd visit — same country, but sentinel is now set. The user
    // intentionally navigated to a non-localized path. Middleware
    // skips geo and uses DEFAULT_LOCALE so the user isn't stuck.
    const second = middleware(
      makeRequest("https://kalki.local/wallet", {
        cookies: { [GEO_ROUTED_COOKIE]: "1" },
        country: "BR",
      }),
    );
    expect(locationOf(second)).toBe(`/${DEFAULT_LOCALE}/wallet`);
  });

  it("preferred_language cookie wins over the sentinel", () => {
    // User had the sentinel set (was geo-routed once) and then later
    // explicitly picked Spanish via the switcher. The cookie now
    // exists. Subsequent visits go to /es/, not the default.
    const res = middleware(
      makeRequest("https://kalki.local/", {
        cookies: {
          [GEO_ROUTED_COOKIE]: "1",
          [PREFERRED_LOCALE_COOKIE]: "es",
        },
      }),
    );
    expect(locationOf(res)).toBe("/es");
  });

  it("AL wins over the sentinel too — sentinel only blocks geo", () => {
    const res = middleware(
      makeRequest("https://kalki.local/wallet", {
        cookies: { [GEO_ROUTED_COOKIE]: "1" },
        acceptLanguage: "pt-BR,pt;q=0.9",
      }),
    );
    expect(locationOf(res)).toBe("/pt/wallet");
  });
});

/* ============================================================
   10. Status codes
   ============================================================ */

describe("middleware: HTTP semantics", () => {
  it("uses a 3xx redirect (not 301 permanent)", () => {
    const res = middleware(
      makeRequest("https://kalki.local/", { country: "BR" }),
    );
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    // 301 would let intermediate proxies cache the redirect
    // permanently — geo state changes (VPN, travel) and a cached
    // permanent redirect would break language switching. We use 307
    // (Temporary Redirect) which preserves the method and is the
    // modern replacement for 302.
    expect(res.status).not.toBe(301);
    expect(res.status).not.toBe(308);
  });
});
