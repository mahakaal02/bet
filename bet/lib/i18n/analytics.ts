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
 */
export function withPreservedParams(
  targetPath: string,
  source: URLSearchParams | null | undefined,
): string {
  if (!source) return targetPath;
  const qs = source.toString();
  if (!qs) return targetPath;
  // Don't double-append if the target already has a `?` — merge.
  if (targetPath.includes("?")) {
    const [path, existing] = targetPath.split("?", 2);
    const merged = new URLSearchParams(existing);
    for (const [k, v] of source.entries()) {
      // Target wins for conflicts (most-recent intent).
      if (!merged.has(k)) merged.set(k, v);
    }
    return `${path}?${merged.toString()}`;
  }
  return `${targetPath}?${qs}`;
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
