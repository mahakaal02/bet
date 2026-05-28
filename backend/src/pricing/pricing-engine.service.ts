import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  BASELINE_COUNTRY,
  COUNTRY_BY_CODE,
  MULTIPLIER_CEIL,
  MULTIPLIER_FLOOR,
} from './pricing.config';
import { roundPriceForRegion } from './regional-rounding';

/**
 * Pure pricing math. NO database, NO HTTP — every method is a
 * deterministic function of its inputs, which is what makes the
 * yearly sync idempotent and the whole thing unit-testable.
 *
 * The hybrid model from the spec:
 *
 *   local_price = base_usd_price × ppp_multiplier × exchange_rate
 *
 * then country-specific psychological rounding.
 */

export interface NormalizedMultiplier {
  country: string;
  rawValue: number | null;
  multiplier: number;
  /** True when we clamped an outlier or used a fallback (no raw data). */
  isFallback: boolean;
}

export interface PricedRow {
  country: string;
  currency: string;
  baseUsdPrice: string;
  forexRate: string;
  pppMultiplier: string;
  calculatedLocalPrice: string;
  roundedFinalPrice: string;
}

@Injectable()
export class PricingEngine {
  /**
   * Normalize raw affordability values (e.g. GDP/capita-PPP) into
   * per-country multipliers anchored at the baseline = 1.0, then clamp
   * to [MULTIPLIER_FLOOR, MULTIPLIER_CEIL].
   *
   *   multiplier(c) = clamp( raw(c) / raw(BASELINE) )
   *
   * A country richer than the baseline lands > 1 (clamped at ceil); a
   * poorer one lands < 1 (clamped at floor). Countries with no raw
   * datum get the floor as a conservative fallback (cheapest tier we'd
   * offer) and are flagged so the admin can override.
   */
  normalizeMultipliers(
    rawByCountry: Readonly<Record<string, number>>,
    countries: readonly string[],
    baselineCountry: string = BASELINE_COUNTRY,
  ): NormalizedMultiplier[] {
    const baselineRaw = rawByCountry[baselineCountry];
    if (!baselineRaw || baselineRaw <= 0) {
      throw new Error(
        `cannot normalize: baseline country ${baselineCountry} has no positive PPP datum`,
      );
    }

    return countries.map((country) => {
      // Baseline is always exactly 1.0 by definition.
      if (country === baselineCountry) {
        return {
          country,
          rawValue: baselineRaw,
          multiplier: 1,
          isFallback: false,
        };
      }

      const raw = rawByCountry[country];
      if (raw === undefined || !Number.isFinite(raw) || raw <= 0) {
        // No data → conservative floor, flagged for admin review.
        return {
          country,
          rawValue: null,
          multiplier: MULTIPLIER_FLOOR,
          isFallback: true,
        };
      }

      const ratio = new Decimal(raw).dividedBy(baselineRaw);
      const clamped = Decimal.min(
        Decimal.max(ratio, MULTIPLIER_FLOOR),
        MULTIPLIER_CEIL,
      );
      const wasClamped = !clamped.equals(ratio);
      return {
        country,
        rawValue: raw,
        // 4dp keeps the snapshot stable + readable.
        multiplier: Number(clamped.toDecimalPlaces(4)),
        isFallback: wasClamped,
      };
    });
  }

  /**
   * Compute one priced row. Pure: same inputs → same outputs, so the
   * annual sync can re-run safely (idempotent).
   *
   *   calculated = baseUsd × multiplier × usdRate
   *   rounded    = roundPriceForRegion(country, calculated)
   *
   * The baseline country (US) is a special case: its multiplier is 1
   * and its forex rate is 1, so the rounded price is just the charm-99
   * of the base USD price — exactly the canonical "$0.99" the pack was
   * authored with.
   */
  priceRow(params: {
    country: string;
    baseUsdPrice: Decimal.Value;
    multiplier: number;
    /** Units of the country's currency per 1 USD. */
    usdRate: Decimal.Value;
  }): PricedRow {
    const cfg = COUNTRY_BY_CODE.get(params.country);
    if (!cfg) {
      throw new Error(`priceRow: unknown country ${params.country}`);
    }

    const baseUsd = new Decimal(params.baseUsdPrice);
    const mult = new Decimal(params.multiplier);
    const rate = new Decimal(params.usdRate);

    const calculated = baseUsd.times(mult).times(rate);
    const rounded = roundPriceForRegion(params.country, calculated);

    return {
      country: params.country,
      currency: cfg.currency,
      baseUsdPrice: baseUsd.toFixed(2),
      forexRate: rate.toFixed(6),
      pppMultiplier: mult.toFixed(4),
      calculatedLocalPrice: calculated.toFixed(4),
      roundedFinalPrice: rounded.toFixed(cfg.fractionDigits),
    };
  }
}
