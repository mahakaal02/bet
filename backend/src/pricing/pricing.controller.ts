import { Controller, Get, Optional, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  CountryDetectionService,
  type CountrySignals,
} from './country-detection.service';
import { PricingService } from './pricing.service';

/**
 * Public pricing API.
 *
 *   GET /pricing/current
 *     → localized coin-pack prices for the caller's resolved country.
 *
 * Unauthenticated by design — the storefront price list is shown
 * before login. Country is resolved server-side from request signals;
 * a logged-in caller's verified billing country (when present) takes
 * precedence over any IP/header hint.
 *
 * Anti-arbitrage: we deliberately resolve the region SERVER-side and
 * never let a raw `?country=` query alone set the price (it's accepted
 * only as the lowest-trust hint, below billing + geo + Accept-Language;
 * see CountryDetectionService trust order). The actual *charge* is
 * always validated against the store receipt's region at purchase time
 * (see PRICING.md → anti-abuse).
 */
@Controller('pricing')
export class PricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly detector: CountryDetectionService,
  ) {}

  @Get('current')
  async current(
    @Req() req: Request,
    @Optional() @Query('country') countryHint?: string,
  ) {
    const header = (name: string): string | null => {
      const v = req.headers[name.toLowerCase()];
      return Array.isArray(v) ? v[0] : (v ?? null);
    };

    const signals: CountrySignals = {
      // Verified billing country would be attached by an auth/billing
      // guard in a logged-in flow; absent here for the public list.
      billingCountry: header('x-kalki-billing-country'),
      profileCountry: null,
      geoHeaderCountry:
        header('cf-ipcountry') ??
        header('x-vercel-ip-country') ??
        header('x-real-country'),
      acceptLanguage: header('accept-language'),
      // `?country=` is the lowest-trust hint — only used if nothing
      // else resolves (and never overrides a verified billing region).
      ipCountry: countryHint ?? null,
    };

    const resolved = this.detector.resolve(signals);
    return this.pricing.getCurrentPricing(resolved);
  }
}
