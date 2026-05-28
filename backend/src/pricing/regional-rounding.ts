import Decimal from 'decimal.js';
import {
  COUNTRY_BY_CODE,
  RoundingStrategy,
  type CountryConfig,
} from './pricing.config';

/**
 * Country-specific psychological ("charm") price rounding.
 *
 * The raw PPP-computed price (e.g. ₹33.07) is never what we charge —
 * every market has a culturally-expected price point. This module is
 * the single source of that logic, kept pure (no I/O, no Prisma) so
 * it's trivially unit-testable.
 *
 *   roundPriceForRegion("IN", 33.07) → 39
 *   roundPriceForRegion("US", 0.91)  → 0.99
 *   roundPriceForRegion("BR", 17.2)  → 17.99
 *   roundPriceForRegion("JP", 143)   → 150
 *   roundPriceForRegion("ID", 14250) → 14500
 *
 * All math goes through decimal.js to avoid binary-float drift on
 * money. We ALWAYS round UP to the charm point (never down) so the
 * published price can't dip below the PPP-fair value.
 */

/** Round UP to the nearest x.99 in the currency's minor unit. */
function charm99Minor(value: Decimal): Decimal {
  // Strip to whole units, then the .99 above the floor. If the value
  // is already ≤ x.99 for its integer floor, that's the target;
  // otherwise bump to the next integer's .99.
  const floor = value.floor();
  const candidate = floor.plus('0.99');
  if (value.lessThanOrEqualTo(candidate)) return candidate;
  return floor.plus(1).plus('0.99');
}

/**
 * Round UP to a whole number ending in 9, scaled to the value's
 * magnitude so small and large prices both look intentional:
 *
 *   < 100   → nearest 9      (33 → 39, 41 → 49)
 *   < 1000  → nearest 90+9   (142 → 149, 153 → 159)  [step 10, end 9]
 *   ≥ 1000  → nearest 90/990 (1 240 → 1 249? no — 1 299)
 *
 * Implementation: pick a step by magnitude, round the value UP to the
 * next multiple of `step`, then subtract 1 so it ends in 9.
 */
function charm9Whole(value: Decimal): Decimal {
  const v = value.ceil();
  let step: Decimal;
  if (v.lessThan(100)) step = new Decimal(10);
  else if (v.lessThan(1000)) step = new Decimal(10);
  else if (v.lessThan(10000)) step = new Decimal(100);
  else step = new Decimal(1000);

  // Smallest multiple of `step` that is ≥ v, then minus 1 → ends in 9.
  const mult = v.dividedBy(step).ceil().times(step);
  const charm = mult.minus(1);
  // Guard: if v already equals a charm point (e.g. 39), keep it.
  return charm.greaterThanOrEqualTo(v) ? charm : charm.plus(step);
}

/** Round UP to the nearest multiple of `n` whole units. */
function nearestWhole(value: Decimal, n: number): Decimal {
  const step = new Decimal(n);
  return value.dividedBy(step).ceil().times(step);
}

const STRATEGIES: Record<RoundingStrategy, (v: Decimal) => Decimal> = {
  charm_99_minor: charm99Minor,
  charm_9_whole: charm9Whole,
  nearest_10_whole: (v) => nearestWhole(v, 10),
  nearest_100_whole: (v) => nearestWhole(v, 100),
  nearest_500_whole: (v) => nearestWhole(v, 500),
};

/**
 * Apply the configured psychological rounding for `country` to a raw
 * price. Falls back to a sane 2-dp ceil for unknown countries (the
 * pricing engine only ever calls this with catalog countries, but the
 * guard keeps the util safe to reuse elsewhere).
 *
 * Accepts string | number | Decimal so callers don't have to wrap.
 * Returns a Decimal — caller decides serialization.
 */
export function roundPriceForRegion(
  country: string,
  value: Decimal.Value,
): Decimal {
  const cfg: CountryConfig | undefined = COUNTRY_BY_CODE.get(
    country.toUpperCase(),
  );
  const v = new Decimal(value);
  if (v.lessThanOrEqualTo(0)) return new Decimal(0);
  if (!cfg) {
    // Unknown market — round up to 2dp. Never crash on a stray code.
    return v.toDecimalPlaces(2, Decimal.ROUND_UP);
  }
  const rounded = STRATEGIES[cfg.rounding](v);
  // Normalize to the currency's fraction digits so JPY/IDR come back
  // as integers and USD/EUR as 2dp.
  return rounded.toDecimalPlaces(cfg.fractionDigits, Decimal.ROUND_HALF_UP);
}
