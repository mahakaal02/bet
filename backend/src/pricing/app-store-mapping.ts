import Decimal from 'decimal.js';

/**
 * App Store / Google Play tier mapping.
 *
 * Apple and Google don't let you charge an arbitrary local price —
 * you pick from a fixed ladder of "price tiers" / "price points" per
 * storefront. Our PPP engine produces a *suggested* local price; this
 * module snaps that suggestion to the nearest valid store tier so the
 * value the admin sees maps cleanly to what you'd actually configure
 * in App Store Connect / Play Console.
 *
 * NOTE: the full tier tables are large and storefront-specific; what
 * we encode here is the COMMON price-point ladder (the charm-99 / x9
 * grid both stores use for the low tiers that coin packs live in).
 * This is a *suggestion* aid for the admin dashboard, not a billing
 * authority — the actual charge is always whatever tier the admin
 * commits in the store consoles.
 */

export interface StoreTierSuggestion {
  /** The price we'd suggest configuring in the store console. */
  tierPrice: string;
  /** A human label, e.g. "Tier ~0.99" — the stores use opaque tier
   *  numbers per storefront, so we describe by value not by index. */
  label: string;
  /** True when our computed price already sits on a clean tier. */
  exact: boolean;
}

/**
 * Common low-end store price points (USD-equivalent ladder). Both
 * Apple and Google align their low tiers to this charm grid; the
 * actual local-currency tier is the storefront's equivalent of these.
 * We match the COMPUTED local price to the nearest rung that is ≥ it
 * (never suggest charging less than the PPP-fair price).
 */
const CHARM_LADDER_99 = [
  0.49, 0.99, 1.49, 1.99, 2.99, 3.99, 4.99, 5.99, 6.99, 7.99, 8.99, 9.99,
  10.99, 11.99, 12.99, 14.99, 19.99, 24.99, 29.99, 39.99, 49.99, 99.99,
];

const CHARM_LADDER_9_WHOLE = [
  9, 19, 29, 39, 49, 59, 69, 79, 89, 99, 149, 199, 249, 299, 399, 499, 699,
  999, 1499, 1999, 2999, 4999, 9999,
];

/**
 * Suggest the store tier for a computed local price.
 *
 * @param value         computed/rounded local price
 * @param fractionDigits 2 for charm-99 currencies, 0 for whole-unit
 *                       (JPY/IDR-style) — selects which ladder to snap to
 */
export function suggestStoreTier(
  value: Decimal.Value,
  fractionDigits: number,
): StoreTierSuggestion {
  const v = new Decimal(value);
  const ladder = fractionDigits === 0 ? CHARM_LADDER_9_WHOLE : CHARM_LADDER_99;

  // Smallest ladder rung ≥ value.
  const rung = ladder.find((r) => v.lessThanOrEqualTo(r));
  if (rung !== undefined) {
    const exact = v.equals(rung);
    return {
      tierPrice: new Decimal(rung).toFixed(fractionDigits),
      label: `Tier ~${rung}`,
      exact,
    };
  }

  // Above the ladder — round up to the nearest 100 (whole) or 50
  // (minor) so very large packs still snap to a sane point.
  const step = fractionDigits === 0 ? 100 : 50;
  const snapped = v.dividedBy(step).ceil().times(step).minus(fractionDigits === 0 ? 1 : 0.01);
  return {
    tierPrice: snapped.toFixed(fractionDigits),
    label: `Tier ~${snapped.toFixed(fractionDigits)} (above standard ladder)`,
    exact: false,
  };
}
