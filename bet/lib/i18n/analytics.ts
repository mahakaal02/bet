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
 * Build a "redirect-to-login" URL targeting the hub's single sign-in
 * surface (PR-SINGLE-LOGIN). Bet no longer hosts its own login page —
 * all auth lives at the auctions hub. Un-authenticated requests to
 * bet routes bounce to `${HUB}/login`, which on success returns the
 * user to the hub's three-game picker. The user clicks the Exchange
 * tile to re-enter bet via SSO (token bridge).
 *
 *   buildAuthRedirect("/wallet", searchParams, "pt")
 *     → "https://kalki.exchange/login"   (next= dropped — see below)
 *
 * Why we drop the `next=` for deep links into bet:
 *
 *   The auctions login only follows `next` when it's a SAME-ORIGIN
 *   path (security — it doesn't want to redirect into attacker-
 *   controlled domains). A cross-origin `next` pointing at the bet
 *   app would be silently dropped anyway, so we omit it and let the
 *   post-login flow land the user on the hub. From there they pick
 *   Exchange and SSO into bet via `?token=…`.
 *
 *   UTM / click-IDs / referral codes that were on the inbound URL
 *   survive to the hub login via the cross-origin Referer header;
 *   the hub records its own attribution.
 *
 * The `targetPath`, `searchParams` and `locale` parameters are
 * retained for backwards compatibility with the previous in-app
 * /[locale]/login routine (now deleted). They're documented so call
 * sites that pass them stay readable, but only `targetPath` and the
 * searchParams shape are honored — for analytics observability into
 * "what bet route triggered the auth bounce".
 */
export function buildAuthRedirect(
  /** Target path the user was originally trying to reach (kept for
   *  analytics / logging only; the actual redirect is to the hub). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  targetPath: string,
  /** searchParams on the gated page that triggered the redirect.
   *  Currently unused at the redirect site (the hub captures its
   *  own attribution via Referer); kept for signature stability. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  searchParams:
    | URLSearchParams
    | Record<string, string | string[] | undefined>
    | null
    | undefined,
  /** Active locale — unused for the redirect itself (the hub login
   *  is single-locale today) but accepted so call sites don't have
   *  to special-case the i18n migration. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  locale: string,
): string {
  // Inline the hub URL resolution so analytics.ts has no dependency
  // on @/lib/hub (keeps the i18n module dictionary-free and bundler-
  // friendly for client components that import from this file).
  const fromEnv = process.env.NEXT_PUBLIC_AUCTIONS_URL;
  const base = fromEnv
    ? fromEnv.replace(/\/$/, "")
    : "http://localhost:3200";
  return `${base}/login`;
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
