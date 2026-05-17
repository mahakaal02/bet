/**
 * Constant-product AMM for binary outcomes (Polymarket / Uniswap-v2 style).
 * The market holds a reserve of YES and NO shares, and the marginal price
 * of each side is its relative scarcity:
 *
 *   priceYes = noShares / (yesShares + noShares)
 *   priceNo  = yesShares / (yesShares + noShares)   = 1 - priceYes
 *
 * Buying YES with C coins — the "split-coin" model:
 *
 *   1.  Take in C coins (minus fee F → c = C - F).
 *   2.  Each coin can be split into 1 YES + 1 NO share at par. The market
 *       conceptually mints c YES + c NO from your c coins.
 *   3.  Deposit the c NO into the pool. The pool now has yes_reserve +0,
 *       no_reserve + c. To re-establish k = yes * no, the pool returns
 *       (yes_reserve − k/(no_reserve + c)) YES to you.
 *   4.  You walk away with:
 *           sharesOut = c                                     (own split)
 *                     + (yes_reserve − k/(no_reserve + c))   (pool transfer)
 *
 * Bounds: average price = C / sharesOut is ALWAYS in [marginal_price, 1].
 * It equals the marginal price only in the limit C → 0; for larger trades
 * it drifts toward 1 because each coin you spend pushes the price up. A
 * 1000-coin buy at marginal 0.50 produces avg ≈ 0.67 and ~1487 shares
 * (which on a YES resolution pays out 1487 coins → +487 profit).
 *
 * The earlier version of this file omitted step 4's first term — only the
 * pool transfer was credited to the buyer — which produced impossible
 * average prices > 1. `scripts/backfill-amm-bug.ts` retroactively credits
 * the missing `c` shares to every Position affected before the fix.
 */
export interface Reserves {
  yesShares: number;
  noShares: number;
}

export interface QuoteResult {
  /** Shares the user receives. */
  sharesOut: number;
  /** Average price paid per share (0..1). */
  avgPrice: number;
  /** Price of the YES side after the trade (0..1). */
  newYesPrice: number;
  /** Reserves after the trade — caller persists them. */
  newReserves: Reserves;
}

const FEE_BPS = 100; // 1% fee, added to the cost. Returned to the AMM (raises k).

export function priceYes(r: Reserves): number {
  const denom = r.yesShares + r.noShares;
  if (denom <= 0) return 0.5;
  return r.noShares / denom;
}

export function priceNo(r: Reserves): number {
  return 1 - priceYes(r);
}

/**
 * Quote the result of buying `outcome` shares with `coins` (gross, fee-
 * inclusive). Returns null if the inputs are invalid or the trade would
 * drain a reserve below epsilon.
 *
 * Implements the split-coin model documented in the file header.
 */
export function quoteBuy(
  reserves: Reserves,
  outcome: "YES" | "NO",
  coins: number,
): QuoteResult | null {
  if (!Number.isFinite(coins) || coins <= 0) return null;
  const fee = (coins * FEE_BPS) / 10_000;
  const c = coins - fee; // post-fee coins that become liquidity / shares
  if (c <= 0) return null;
  const k = reserves.yesShares * reserves.noShares;
  if (k <= 0) return null;

  let newYes: number;
  let newNo: number;
  let poolTransfer: number;

  if (outcome === "YES") {
    // The c coins split into c YES + c NO. The c NO joins the pool. The
    // pool then trades back YES until k is preserved.
    newNo = reserves.noShares + c;
    newYes = k / newNo;
    poolTransfer = reserves.yesShares - newYes;
  } else {
    newYes = reserves.yesShares + c;
    newNo = k / newYes;
    poolTransfer = reserves.noShares - newNo;
  }

  // The user keeps their own split's matching side AND the pool's transfer.
  const sharesOut = c + poolTransfer;

  if (!Number.isFinite(sharesOut) || sharesOut <= 0) return null;
  if (newYes < 1 || newNo < 1) return null; // protect against runaway slippage
  if (poolTransfer < 0) return null;        // defensive — should never happen

  const newReserves: Reserves = { yesShares: newYes, noShares: newNo };
  const avgPrice = coins / sharesOut;
  // Sanity invariant: a CPMM buy can never produce an average price outside
  // [marginal_price_before, 1]. Reject if floating-point error pushes us out.
  if (avgPrice > 1 + 1e-9 || avgPrice <= 0) return null;

  return {
    sharesOut,
    avgPrice,
    newYesPrice: priceYes(newReserves),
    newReserves,
  };
}

/** Round a coin amount to a whole-integer charge. */
export function chargeForCoins(coins: number): number {
  return Math.max(1, Math.round(coins));
}

export interface SellQuoteResult {
  /** Coins the user receives (net of fee). */
  coinsOut: number;
  /** Average price received per share. */
  avgPrice: number;
  /** Price of the YES side after the trade (0..1). */
  newYesPrice: number;
  /** New AMM reserves. */
  newReserves: Reserves;
}

/**
 * Quote the result of selling `shares` of `outcome` back to the AMM. The
 * symmetric inverse of `quoteBuy` — same split/merge model:
 *
 *   1. User deposits `Q` unpaired YES (say) shares.
 *   2. Pool returns `c` paired shares (c YES + c NO) preserving k:
 *        (Y + Q − c)(N − c) = k = Y · N
 *        → c² − (Y + Q + N)c + Q·N = 0
 *        → c = ((Y + Q + N) − √((Y + Q + N)² − 4·Q·N)) / 2
 *   3. The contract atomically merges the c YES + c NO into c coins.
 *   4. Apply 1% fee on the coin output (returns to the pool's k as LP rake).
 *
 * Bounds: avgPrice is always in (0, marginal_before). Sells push the price
 * of the side being sold DOWN; the user receives slightly less than the
 * marginal price would suggest because their own sell moves the price.
 *
 * Example at 50/50 with Q=100:
 *   c = (2100 − √(2100² − 400000)) / 2 ≈ 48.74
 *   avg ≈ 0.482 (after fee), just below the 0.50 marginal-before.
 */
export function quoteSell(
  reserves: Reserves,
  outcome: "YES" | "NO",
  shares: number,
): SellQuoteResult | null {
  if (!Number.isFinite(shares) || shares <= 0) return null;
  const k = reserves.yesShares * reserves.noShares;
  if (k <= 0) return null;

  // Map (selling outcome, other reserve) → (Y, N) for the formula. We
  // un-swap below when constructing newReserves.
  let Y: number;
  let N: number;
  if (outcome === "YES") {
    Y = reserves.yesShares;
    N = reserves.noShares;
  } else {
    Y = reserves.noShares;
    N = reserves.yesShares;
  }
  const Q = shares;

  // Pick the smaller root — the larger one would drain N below zero.
  const b = Y + Q + N;
  const disc = b * b - 4 * Q * N;
  if (disc < 0) return null;
  const c = (b - Math.sqrt(disc)) / 2;
  if (!Number.isFinite(c) || c <= 0) return null;
  if (c >= N) return null;

  // 1% fee on the coin output.
  const fee = (c * FEE_BPS) / 10_000;
  const coinsOut = c - fee;
  if (coinsOut <= 0) return null;

  const newY = Y + Q - c;
  const newN = N - c;
  if (newY < 1 || newN < 1) return null;
  // Slippage guard: refuse if the trade would drain the depleting side to
  // <10% of its original size. Past that point the average price is
  // pathologically below marginal — users would be wrecking themselves.
  if (newN < N * 0.1) return null;

  const newReserves: Reserves =
    outcome === "YES"
      ? { yesShares: newY, noShares: newN }
      : { yesShares: newN, noShares: newY };

  const avgPrice = coinsOut / Q;
  const marginalBefore =
    outcome === "YES"
      ? reserves.noShares / (reserves.yesShares + reserves.noShares)
      : reserves.yesShares / (reserves.yesShares + reserves.noShares);
  // Invariant: AMM sells can never produce an avg price > marginal_before.
  if (avgPrice <= 0 || avgPrice > marginalBefore + 1e-9) return null;

  return {
    coinsOut,
    avgPrice,
    newYesPrice: priceYes(newReserves),
    newReserves,
  };
}
