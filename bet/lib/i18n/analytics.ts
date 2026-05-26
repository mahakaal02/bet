/**
 * Analytics-attribution helpers for the i18n layer (PR-BET-I18N).
 *
 * Two unrelated-looking concerns share this module because they
 * both sit on the boundary between i18n and downstream analytics:
 *
 *   1. URL-PARAM PRESERVATION — when middleware geo-redirects from
 *      `/wallet?utm_campaign=launch` to `/pt/wallet?utm_campaign=launch`,
 *      or when the language switcher swaps `/pt/wallet?ref=alice` to
 *      `/en/wallet?ref=alice`, the marketing/referral state must
 *      survive. Otherwise attribution looks like the user came from
 *      "direct" instead of the campaign that actually drove the visit.
 *
 *   2. LOCALE DIMENSION — analytics scripts (Plausible / PostHog /
 *      etc.) want a stable string to tag events with so dashboards
 *      can slice by language. We expose helpers that give them a
 *      canonical shape rather than every page importing `Locale`
 *      and stringifying ad-hoc.
 *
 * No bundle weight in the browser unless a caller imports the
 * functions — every helper is pure data.
 */

import type { Locale, Direction } from "./config";
import { dirForLocale } from "./config";

/* ============================================================
   Tracking-param vocabulary
   ============================================================ */

/**
 * Well-known query-string keys that carry attribution / tracking
 * state. Lower-case match — `URLSearchParams` is case-sensitive,
 * so callers should normalize the source before matching.
 *
 *   • UTM family — Google's canonical campaign tagging
 *   • Click IDs — gclid (Google Ads), fbclid (Meta), msclkid (Bing
 *     Ads), ttclid (TikTok Ads), twclid (Twitter Ads), yclid
 *     (Yandex), wbraid/gbraid (newer Google iOS), dclid (Display)
 *   • Referral / sharing — `ref`, `referrer`, `aff`, `affiliate`,
 *     `referral_code`, `invite`, `r` — match our switcher's
 *     /invite/?ref=… surface
 *   • Session/cookie aliases (cross-domain) — `_ga`, `_gl`
 *
 * NOT exhaustive — when a new ad network ships, add the click-id
 * key here. The downside of an over-broad list is harmless (we
 * just preserve the param); the downside of an under-broad list
 * is broken attribution.
 */
export const TRACKING_PARAM_KEYS: ReadonlyArray<string> = [
  // UTM
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  // Click IDs
  "gclid",
  "gbraid",
  "wbraid",
  "dclid",
  "fbclid",
  "msclkid",
  "ttclid",
  "twclid",
  "yclid",
  "li_fat_id", // LinkedIn
  "mc_cid", // Mailchimp
  "mc_eid", // Mailchimp
  // Referral / sharing surfaces
  "ref",
  "referrer",
  "referral",
  "referral_code",
  "aff",
  "affiliate",
  "invite",
  "r",
  // Cross-domain session linkers
  "_ga",
  "_gl",
];

/**
 * Pull every known tracking key out of a `URLSearchParams` (or
 * `Record<string, string>`-shaped object) into a flat dict. Returns
 * an empty object when nothing matches — easy to spread into a
 * downstream URL or analytics event payload.
 */
export function extractTrackingParams(
  source: URLSearchParams | Record<string, string | string[] | undefined> | null | undefined,
): Record<string, string> {
  if (!source) return {};
  const out: Record<string, string> = {};

  const get = (key: string): string | undefined => {
    if (source instanceof URLSearchParams) {
      return source.get(key) ?? undefined;
    }
    const raw = (source as Record<string, string | string[] | undefined>)[key];
    if (Array.isArray(raw)) return raw[0];
    return raw ?? undefined;
  };

  for (const key of TRACKING_PARAM_KEYS) {
    const v = get(key);
    if (v !== undefined && v !== "") out[key] = v;
  }
  return out;
}

/**
 * Reattach a tracking-params subset onto a target path. Idempotent —
 * if the target already carries the params, they stay (with target
 * values winning). Used by the language switcher to keep
 * attribution attached when swapping locales mid-session.
 *
 *   appendTrackingParams("/en/wallet", { utm_source: "twitter" })
 *     → "/en/wallet?utm_source=twitter"
 *   appendTrackingParams("/en/wallet?utm_id=x", { utm_id: "y" })
 *     → "/en/wallet?utm_id=x"           ← target wins; idempotent
 */
export function appendTrackingParams(
  targetPath: string,
  params: Record<string, string>,
): string {
  if (Object.keys(params).length === 0) return targetPath;
  const [pathPart, existing = ""] = targetPath.split("?", 2);
  const merged = new URLSearchParams(existing);
  for (const [k, v] of Object.entries(params)) {
    // Don't overwrite explicit values already on the target — the
    // target represents the user's most-recent intent.
    if (!merged.has(k)) merged.set(k, v);
  }
  const qs = merged.toString();
  return qs.length > 0 ? `${pathPart}?${qs}` : pathPart;
}

/**
 * One-call helper for the language switcher and similar contexts:
 * given the current URLSearchParams, build a target URL that
 * preserves every interesting query key.
 *
 *   const target = withPreservedParams("/en/wallet", currentParams);
 *
 * For UX consistency we currently preserve ALL params, not just
 * tracking ones — a user who switches language while looking at
 * `/pt/markets?q=foo&sort=volume` expects to land on
 * `/en/markets?q=foo&sort=volume`. The tracking-only API
 * (`extractTrackingParams` + `appendTrackingParams`) exists for
 * analytics use cases where you specifically want the marketing
 * subset, e.g. when sending events to a downstream pipeline.
 *
 * Optionally accepts a hash fragment (e.g. "#comments-section")
 * which is appended after the query string. Pass `null`/`undefined`
 * to skip — typical for non-client-side callers that don't have a
 * `window.location.hash` to read.
 */
export function withPreservedParams(
  targetPath: string,
  source: URLSearchParams | null | undefined,
  hash?: string | null,
): string {
  // Normalize the hash: strip leading "#" if present, then re-prefix
  // when we have something. Empty hash is treated as no hash.
  const normalizedHash =
    hash && hash.length > 0
      ? hash.startsWith("#")
        ? hash
        : `#${hash}`
      : "";

  if (!source) {
    return targetPath + normalizedHash;
  }
  const qs = source.toString();
  if (!qs) return targetPath + normalizedHash;
  // Don't double-append if the target already has a `?` — merge.
  if (targetPath.includes("?")) {
    const [path, existing] = targetPath.split("?", 2);
    const merged = new URLSearchParams(existing);
    for (const [k, v] of source.entries()) {
      // Target wins for conflicts (most-recent intent).
      if (!merged.has(k)) merged.set(k, v);
    }
    return `${path}?${merged.toString()}${normalizedHash}`;
  }
  return `${targetPath}?${qs}${normalizedHash}`;
}

/**
 * Build a "redirect-to-login-and-come-back-here" URL that preserves
 * the user's full intended destination — including UTM tags, click
 * IDs, and any other query state — across the auth round-trip.
 *
 *   buildAuthRedirect("/wallet", searchParams, "pt")
 *     → "/pt/login?next=%2Fpt%2Fwallet%3Futm_source%3Dtwitter"
 *
 * Why a dedicated helper instead of inlining the encoding? Two
 * reasons:
 *   1. Centralises the `next=` URL-encoding rule (it's a URL
 *      *inside* a URL, so the inner one MUST be encoded once or
 *      it'll get interpreted as the outer query).
 *   2. Every auth-gated server component had to make this decision
 *      and most got it wrong — `redirect(lp("/login?next=/wallet"))`
 *      ships the BARE path as the next target and silently drops
 *      attribution on the round-trip.
 *
 * Use from server components:
 *
 *   import { buildAuthRedirect } from "@/lib/i18n";
 *
 *   export default async function WalletPage({ params, searchParams }) {
 *     const { locale } = await params;
 *     const sp = await searchParams;
 *     const u = await getAuthedUser();
 *     if (!u) redirect(buildAuthRedirect("/wallet", sp, locale));
 *     // ...
 *   }
 *
 * `searchParams` is the Next.js server-component shape
 * (`Record<string, string | string[] | undefined>`). Arrays collapse
 * to first value; empty / missing keys are skipped.
 */
export function buildAuthRedirect(
  /** Target path inside the locale tree (no locale prefix). */
  targetPath: string,
  /** searchParams on the gated page that triggered the redirect. */
  searchParams:
    | URLSearchParams
    | Record<string, string | string[] | undefined>
    | null
    | undefined,
  /** Locale to prefix on both /login and the `next=` target. */
  locale: string,
  /** Which auth surface to send the user to. Defaults to "/login". */
  loginPath: string = "/login",
): string {
  // Normalize searchParams to URLSearchParams so we can serialize.
  let sp: URLSearchParams;
  if (searchParams instanceof URLSearchParams) {
    sp = searchParams;
  } else if (searchParams) {
    sp = new URLSearchParams();
    for (const [k, raw] of Object.entries(searchParams)) {
      if (raw === undefined || raw === "") continue;
      sp.set(k, Array.isArray(raw) ? (raw[0] ?? "") : raw);
    }
  } else {
    sp = new URLSearchParams();
  }

  // Build the locale-prefixed `next=` target so post-login the user
  // returns to the SAME page in the SAME locale they came from. We
  // intentionally inline the locale prefix instead of calling
  // `localizedPath` to avoid a circular import (analytics ↔ index).
  const innerPath = targetPath.startsWith("/")
    ? `/${locale}${targetPath}`
    : `/${locale}/${targetPath}`;
  const qs = sp.toString();
  const innerFull = qs.length > 0 ? `${innerPath}?${qs}` : innerPath;

  const loginInner = loginPath.startsWith("/")
    ? `/${locale}${loginPath}`
    : `/${locale}/${loginPath}`;
  return `${loginInner}?next=${encodeURIComponent(innerFull)}`;
}

/* ============================================================
   Locale dimension helpers for analytics tagging
   ============================================================ */

/**
 * Canonical locale dimension string. Pass to your analytics
 * provider as a custom dimension on every event so dashboards
 * can slice by language without each script knowing about
 * `Locale` shape.
 *
 *   analytics.track('trade_buy', { locale: localeDimension(locale) });
 */
export function localeDimension(locale: Locale): string {
  return locale;
}

/**
 * Full analytics context for the current locale. Convenient when
 * setting global properties at page load — Plausible's `props`,
 * PostHog's `register`, GA4's `set` etc. all accept a flat object
 * keyed by dimension name.
 *
 *   posthog.register(localeAnalyticsContext(locale));
 *   // → { locale: 'pt', language: 'pt-BR', dir: 'ltr' }
 */
export interface LocaleAnalyticsContext {
  /** Short locale code (matches the URL prefix). */
  locale: Locale;
  /** IETF tag with our defaults (en→en-US, pt→pt-BR, etc.). For
   *  analytics it's helpful to send both — some dashboards plot
   *  with the IETF tag, others with the short code. */
  language: string;
  /** Text direction — useful if your analytics segment by RTL/LTR
   *  audience separately. */
  dir: Direction;
}

const IETF_TAG: Record<Locale, string> = {
  en: "en-US",
  pt: "pt-BR",
  es: "es-ES",
  fr: "fr-FR",
};

export function localeAnalyticsContext(
  locale: Locale,
): LocaleAnalyticsContext {
  return {
    locale,
    language: IETF_TAG[locale] ?? locale,
    dir: dirForLocale(locale),
  };
}
