/**
 * Platform commission rates. Lives in one file so tests + dashboards + the
 * legal/T&Cs page can all read from the same source of truth instead of
 * scattering magic numbers across the codebase.
 *
 *   - BUY  : 2% of coins spent. Skimmed BEFORE the AMM/book leg, so the
 *            user gets shares proportional to the *post-fee* amount and the
 *            pool / maker receives the post-fee amount.
 *   - SELL : 2% of coins received. Skimmed AFTER the AMM/book quote
 *            settles, so the user receives 98% of the gross sale.
 *   - SETTLEMENT : 5% of NET PROFIT (payout − costBasis), and ONLY when
 *            profit is positive. Principal is never docked. This means a
 *            losing position (payout=0) pays no settlement fee at all, and
 *            a winning position that exactly broke even pays no fee.
 *
 * The AMM also takes a 1% LP fee inside `lib/amm.ts` (`FEE_BPS`). That fee
 * stays in the pool to raise k for liquidity providers — it is NOT platform
 * revenue. The 2% commission here is on top of that and is the platform's
 * cut.
 *
 * Rounding policy: fees are always `Math.floor`'d so we never collect a
 * fractional coin we can't actually transfer. The user gets the floor()
 * benefit on sells too — `coinsOut - floor(fee)` rounded down to integer
 * means the platform under-collects by ≤1 coin per fill rather than
 * over-collecting and surprising the user. Verified by the tests below.
 */

export const BUY_FEE_BPS = 200; // 2.00%
export const SELL_FEE_BPS = 200; // 2.00%
export const SETTLEMENT_FEE_BPS = 500; // 5.00% of profit

export const BUY_FEE_PCT = BUY_FEE_BPS / 10_000;
export const SELL_FEE_PCT = SELL_FEE_BPS / 10_000;
export const SETTLEMENT_FEE_PCT = SETTLEMENT_FEE_BPS / 10_000;

/**
 * Pre-trade BUY split. Called with the user's gross intended spend; returns
 * how many coins reach the AMM / orderbook (`netCoins`) and how many are
 * skimmed as platform fee (`fee`).
 *
 *   splitBuy(1000) → { netCoins: 980, fee: 20 }
 *
 * Both are integers — invariant: `netCoins + fee === gross`.
 */
export function splitBuy(grossCoins: number): { netCoins: number; fee: number } {
  if (!Number.isFinite(grossCoins) || grossCoins <= 0) {
    return { netCoins: 0, fee: 0 };
  }
  const gross = Math.floor(grossCoins);
  const fee = Math.floor((gross * BUY_FEE_BPS) / 10_000);
  return { netCoins: gross - fee, fee };
}

/**
 * Post-trade SELL split. Called with the gross coins the AMM/book quoted
 * out; returns how many the user gets to keep and how many the platform
 * skims as fee.
 *
 *   splitSell(1000) → { netCoins: 980, fee: 20 }
 *
 * Invariant: `netCoins + fee === gross`.
 */
export function splitSell(grossCoinsOut: number): {
  netCoins: number;
  fee: number;
} {
  if (!Number.isFinite(grossCoinsOut) || grossCoinsOut <= 0) {
    return { netCoins: 0, fee: 0 };
  }
  const gross = Math.floor(grossCoinsOut);
  const fee = Math.floor((gross * SELL_FEE_BPS) / 10_000);
  return { netCoins: gross - fee, fee };
}

/**
 * Settlement-time payout split. `gross` is the raw winning payout (1 coin
 * per winning share, or refund of costBasis on cancellation). `costBasis`
 * is what the user paid into the position.
 *
 * Returns the net the user is credited and the fee the platform skims.
 * The fee is taken from PROFIT ONLY, never from principal:
 *
 *   splitSettlement(150, 100) → { netPayout: 148, fee: 2 }   // 5% of 50
 *   splitSettlement(100, 100) → { netPayout: 100, fee: 0 }   // break-even
 *   splitSettlement( 80, 100) → { netPayout:  80, fee: 0 }   // underwater
 *   splitSettlement(  0, 100) → { netPayout:   0, fee: 0 }   // total loss
 *
 * Use this on every position at resolution time. Pass `applyFee: false`
 * for cancellation refunds — those return principal and never carry a fee.
 */
export function splitSettlement(
  gross: number,
  costBasis: number,
  opts: { applyFee?: boolean } = {},
): { netPayout: number; fee: number } {
  const applyFee = opts.applyFee ?? true;
  if (!Number.isFinite(gross) || gross <= 0) return { netPayout: 0, fee: 0 };
  const grossFloor = Math.floor(gross);
  if (!applyFee) return { netPayout: grossFloor, fee: 0 };
  const profit = grossFloor - Math.max(0, Math.floor(costBasis));
  if (profit <= 0) return { netPayout: grossFloor, fee: 0 };
  const fee = Math.floor((profit * SETTLEMENT_FEE_BPS) / 10_000);
  return { netPayout: grossFloor - fee, fee };
}
