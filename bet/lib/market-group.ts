import { priceYes, type Reserves } from "@/lib/amm";

/**
 * Grouped-market display helpers.
 *
 * Independent binary markets each price their own YES in isolation, so the raw
 * YES prices of the candidates in a "who will win" event do NOT sum to 1. For a
 * clean ranked display (probability bars that sum to 100%) an EXCLUSIVE group
 * normalizes each child's share of the total YES price.
 *
 * EVERYTHING here is a PURE, DISPLAY-ONLY transform. It never touches the AMM,
 * the stored reserves/prices, the orderbook, or settlement — a child market
 * trades and resolves exactly as a standalone market regardless of grouping.
 */

export interface ChildPrice {
  marketId: string;
  /** Raw market YES price, 0..1. */
  yesPrice: number;
}

export interface NormalizedChild {
  marketId: string;
  /** Unchanged raw YES price (0..1). */
  yesPrice: number;
  /** Integer 0..100. For EXCLUSIVE groups these sum to EXACTLY 100. */
  normalizedPct: number;
}

/** Thin re-export of the AMM YES-price formula so group callers don't
 *  duplicate `noShares / (yesShares + noShares)`. */
export function childYesPrice(r: Reserves): number {
  return priceYes(r);
}

/**
 * EXCLUSIVE group: normalize each child's YES price into a share of 100%.
 *
 * Integers use largest-remainder rounding so they sum to exactly 100 (no
 * 99%/101% artifacts). A non-positive total (all-zero / empty pool) falls back
 * to an even split so the UI never divides by zero or shows NaN.
 */
export function normalizeGroupPrices(children: ChildPrice[]): NormalizedChild[] {
  const n = children.length;
  if (n === 0) return [];

  const total = children.reduce((s, c) => s + safePos(c.yesPrice), 0);
  if (total <= 0) {
    return assignLargestRemainder(children, children.map(() => 100 / n));
  }

  const rawPercents = children.map((c) => (safePos(c.yesPrice) / total) * 100);
  return assignLargestRemainder(children, rawPercents);
}

/** INDEPENDENT group: show each child's raw YES% (rounded), no cross-market
 *  normalization. */
export function rawGroupPrices(children: ChildPrice[]): NormalizedChild[] {
  return children.map((c) => ({
    marketId: c.marketId,
    yesPrice: c.yesPrice,
    normalizedPct: Math.round(clamp01(c.yesPrice) * 100),
  }));
}

/** Normalize (EXCLUSIVE) or pass through raw (INDEPENDENT). */
export function groupDisplayPrices(
  children: ChildPrice[],
  exclusive: boolean,
): NormalizedChild[] {
  return exclusive ? normalizeGroupPrices(children) : rawGroupPrices(children);
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

/** Non-finite (NaN/±Inf) or non-positive prices collapse to 0. Guards the
 *  group total against a single bad child — note `Math.max(0, NaN) === NaN`,
 *  which would otherwise propagate NaN through the whole normalization. */
function safePos(x: number): number {
  return Number.isFinite(x) && x > 0 ? x : 0;
}

/**
 * Largest-remainder rounding: floor every percentage, then hand the leftover
 * whole points to the entries with the largest fractional parts so the integer
 * result sums to exactly 100. Ties broken by input index for deterministic
 * output. Preserves input order in the returned array.
 */
function assignLargestRemainder(
  children: ChildPrice[],
  percents: number[],
): NormalizedChild[] {
  const floors = percents.map((p) => Math.floor(p));
  const used = floors.reduce((s, v) => s + v, 0);
  let remaining = Math.max(0, 100 - used); // whole points still to distribute

  const order = percents
    .map((p, i) => ({ i, frac: p - Math.floor(p) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const result: NormalizedChild[] = children.map((c, i) => ({
    marketId: c.marketId,
    yesPrice: c.yesPrice,
    normalizedPct: floors[i],
  }));

  let k = 0;
  while (remaining > 0 && order.length > 0) {
    result[order[k % order.length].i].normalizedPct += 1;
    remaining -= 1;
    k += 1;
  }
  return result;
}
