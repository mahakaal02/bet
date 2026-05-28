import { Injectable, Logger } from '@nestjs/common';
import {
  COUNTRY_TO_CURRENCY,
  NEAREST_REGION_FALLBACK,
  SUPPORTED_COUNTRIES,
} from './pricing.config';

/**
 * Server-side country resolution for pricing.
 *
 * The frontend (auctions hub) already has a country detector for
 * LANGUAGE selection (auctions/lib/locale-detect.ts). This is the
 * backend equivalent for PRICING — and pricing has a stricter trust
 * model than language: getting the language wrong is cosmetic; getting
 * the price region wrong is a regional-arbitrage hole.
 *
 * Trust order (spec): the user's verified billing country wins; IP
 * geo is a hint; a raw VPN-derived IP is the LEAST trusted and only
 * used when nothing better exists. We never let a client-supplied
 * header alone set the price region — billing country must come from
 * the validated store receipt / user profile, not a request header.
 */

export type CountrySource =
  | 'billing' // verified store/billing region — highest trust
  | 'profile' // user's saved billing country
  | 'geo-header' // edge CDN geo (cf-ipcountry etc.) — medium trust
  | 'accept-language' // browser locale — low trust
  | 'vpn-ip' // raw IP geo, possibly a VPN — lowest trust
  | 'default'; // nothing resolved

export interface ResolvedCountry {
  /** A country we actually price in (after fallback mapping). */
  country: string;
  /** The currency the user bills in (may differ from the priced
   *  country's currency only across EUR members — both resolve to EUR). */
  currency: string;
  /** The raw country we detected, before nearest-region fallback. */
  detectedCountry: string;
  /** How we resolved it — surfaced in the API response + logs. */
  source: CountrySource;
  /** True when `country` came from NEAREST_REGION_FALLBACK or the USD
   *  default rather than a direct catalog hit. */
  usedFallback: boolean;
}

export interface CountrySignals {
  /** Verified billing country from a validated store receipt. */
  billingCountry?: string | null;
  /** User's saved profile billing country. */
  profileCountry?: string | null;
  /** Edge geo header value (cf-ipcountry / x-vercel-ip-country / x-real-country). */
  geoHeaderCountry?: string | null;
  /** Raw Accept-Language header. */
  acceptLanguage?: string | null;
  /** Country derived from the raw socket IP (treat as possibly-VPN). */
  ipCountry?: string | null;
}

const DEFAULT_COUNTRY = 'US';

@Injectable()
export class CountryDetectionService {
  private readonly logger = new Logger(CountryDetectionService.name);

  private isSupported(code: string | null | undefined): code is string {
    return (
      !!code &&
      (SUPPORTED_COUNTRIES as readonly string[]).includes(code.toUpperCase())
    );
  }

  /**
   * Map an Accept-Language IETF tag to a country code. Region subtag
   * wins (`pt-BR` → BR); otherwise the language's primary market.
   * Ported from the frontend detector so behaviour is consistent.
   */
  parseAcceptLanguage(header: string | null | undefined): string | null {
    if (!header) return null;
    const langToCountry: Record<string, string> = {
      en: 'US',
      pt: 'BR',
      es: 'MX',
      fr: 'FR',
      ru: 'RU',
      zh: 'CN',
      id: 'ID',
      ja: 'JP',
      tr: 'TR',
      de: 'FR', // eurozone → FR (EUR)
      ar: 'AE',
      hi: 'IN',
      fil: 'PH',
      tl: 'PH',
    };
    const parts = header
      .split(',')
      .map((p) => {
        const [tag, ...params] = p.trim().split(';');
        const qParam = params.find((x) => x.trim().startsWith('q='));
        const q = qParam ? Number(qParam.trim().slice(2)) : 1;
        return { tag: tag.toLowerCase().trim(), q: Number.isFinite(q) ? q : 0 };
      })
      .filter((p) => p.tag && p.q > 0)
      .sort((a, b) => b.q - a.q);

    for (const { tag } of parts) {
      if (!tag || tag === '*') continue;
      const segments = tag.split(/[-_]/);
      const region = segments[1]?.toUpperCase();
      if (this.isSupported(region)) return region!;
      const lang = segments[0];
      if (langToCountry[lang]) return langToCountry[lang];
    }
    return null;
  }

  /**
   * Resolve the raw detected country from all signals in trust order,
   * THEN map it to a country we actually price in via nearest-region
   * fallback. Returns both so callers can log "detected X, served Y".
   */
  resolve(signals: CountrySignals): ResolvedCountry {
    const candidates: Array<{ code: string | null | undefined; source: CountrySource }> = [
      { code: signals.billingCountry, source: 'billing' },
      { code: signals.profileCountry, source: 'profile' },
      { code: signals.geoHeaderCountry, source: 'geo-header' },
      { code: this.parseAcceptLanguage(signals.acceptLanguage), source: 'accept-language' },
      { code: signals.ipCountry, source: 'vpn-ip' },
    ];

    let detected = DEFAULT_COUNTRY;
    let source: CountrySource = 'default';
    for (const c of candidates) {
      if (c.code) {
        detected = c.code.toUpperCase();
        source = c.source;
        break;
      }
    }

    return this.mapToPriced(detected, source);
  }

  /**
   * Turn a raw detected country into one we price in:
   *   1. exact catalog hit → use it
   *   2. NEAREST_REGION_FALLBACK proxy → use the proxy's pricing but
   *      bill in the user's own currency where we know it
   *   3. USD/US default
   */
  private mapToPriced(detected: string, source: CountrySource): ResolvedCountry {
    if (this.isSupported(detected)) {
      return {
        country: detected,
        currency: COUNTRY_TO_CURRENCY[detected],
        detectedCountry: detected,
        source,
        // `source === 'default'` means NO signal resolved and we fell
        // back to the baseline country. Even though the baseline (US)
        // is a real priced market, from the user's perspective we did
        // NOT serve their detected region — so this is a fallback.
        usedFallback: source === 'default',
      };
    }

    const proxy = NEAREST_REGION_FALLBACK[detected];
    if (proxy && this.isSupported(proxy)) {
      this.logger.debug(
        `country ${detected} not priced directly → nearest region ${proxy}`,
      );
      return {
        country: proxy,
        currency: COUNTRY_TO_CURRENCY[proxy],
        detectedCountry: detected,
        source,
        usedFallback: true,
      };
    }

    return {
      country: DEFAULT_COUNTRY,
      currency: COUNTRY_TO_CURRENCY[DEFAULT_COUNTRY],
      detectedCountry: detected,
      source,
      usedFallback: true,
    };
  }
}
