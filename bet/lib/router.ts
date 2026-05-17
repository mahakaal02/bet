/**
 * Smart trade router — decides whether a market BUY/SELL should be filled
 * by the AMM, the orderbook, or a mix of both. Pure function so the
 * planner is unit-testable; execution lives in `/api/trade/smart`.
 *
 * Strategy: walk the orderbook in price-time priority taking each maker
 * level whose price beats the AMM's marginal at that moment. As we fill,
 * the implicit "AMM marginal price after the book leg" shifts (because
 * we've taken less liquidity from the AMM than we would have), so we
 * recompute it on each iteration to know when to stop walking the book
 * and sweep the rest into the AMM.
 *
 * For a BUY:
 *   - Compare each resting SELL price against the AMM's marginal price.
 *   - Take book levels while their price is BELOW the AMM marginal.
 *   - Once we'd be paying the AMM more anyway, switch to AMM for the rest.
 *
 * For a SELL, reverse: compare each resting BUY price against the AMM's
 * marginal price, take book levels while their price is ABOVE the AMM
 * marginal.
 *
 * Self-trade prevention is enforced here — the user's own resting orders
 * are skipped, same as in the orderbook matcher.
 */

import { priceYes, quoteBuy, quoteSell, type Reserves } from "@/lib/amm";

export interface RestingOrder {
  id: string;
  userId: string;
  limitPrice: number;
  remaining: number;
}

export interface BookLeg {
  kind: "book";
  makerOrderId: string;
  makerUserId: string;
  price: number;
  shares: number;
  coins: number; // for BUY: paid to maker; for SELL: received from maker
}

export interface AmmLeg {
  kind: "amm";
  /** For BUY: coins spent through the AMM. For SELL: shares deposited. */
  input: number;
  /** For BUY: shares received. For SELL: coins received. */
  output: number;
  /** Updated reserves after the AMM leg. */
  newReserves: Reserves;
}

export type PlanLeg = BookLeg | AmmLeg;

export interface BuyPlan {
  side: "BUY";
  outcome: "YES" | "NO";
  /** Total coins the taker spent across all legs. */
  totalCoins: number;
  /** Total shares the taker receives. */
  totalShares: number;
  /** Average price per share. */
  avgPrice: number;
  legs: PlanLeg[];
}

export interface SellPlan {
  side: "SELL";
  outcome: "YES" | "NO";
  /** Total shares the taker delivered across all legs. */
  totalShares: number;
  /** Total coins the taker receives. */
  totalCoins: number;
  /** Average price per share. */
  avgPrice: number;
  legs: PlanLeg[];
}

interface RouteBuyInput {
  takerUserId: string;
  outcome: "YES" | "NO";
  coins: number;
  reserves: Reserves;
  /** Opposite-side resting orders. For BUY: resting SELLs on this outcome. */
  resting: RestingOrder[];
}

interface RouteSellInput {
  takerUserId: string;
  outcome: "YES" | "NO";
  shares: number;
  reserves: Reserves;
  /** Opposite-side resting orders. For SELL: resting BUYs on this outcome. */
  resting: RestingOrder[];
}

/** Marginal price the AMM would quote for `outcome` at the given reserves. */
function ammMarginal(reserves: Reserves, outcome: "YES" | "NO"): number {
  return outcome === "YES" ? priceYes(reserves) : 1 - priceYes(reserves);
}

/**
 * Plan a smart BUY. Returns `null` if the inputs are invalid or the trade
 * can't be filled (e.g. AMM would refuse the remaining size because of the
 * slippage guard).
 */
export function routeBuy(input: RouteBuyInput): BuyPlan | null {
  if (input.coins <= 0) return null;

  let coinsLeft = input.coins;
  let reserves = { ...input.reserves };
  const legs: PlanLeg[] = [];
  let totalShares = 0;

  // Sort resting asks ascending and walk them in order. Skip own + zero-
  // remaining rows up-front so the loop body can stay tidy.
  const asks = input.resting
    .filter((o) => o.userId !== input.takerUserId && o.remaining > 1e-9)
    .sort((a, b) => a.limitPrice - b.limitPrice);

  for (const ask of asks) {
    if (coinsLeft <= 0) break;
    const ammPrice = ammMarginal(reserves, input.outcome);
    // Stop walking once book is at-or-above AMM marginal — AMM is better
    // from here. The +1e-9 absorbs floating-point noise.
    if (ask.limitPrice >= ammPrice - 1e-9) break;

    const maxCoinsAtLevel = ask.remaining * ask.limitPrice;
    const takeCoins = Math.min(coinsLeft, maxCoinsAtLevel);
    if (takeCoins <= 0) continue;
    const takeShares = takeCoins / ask.limitPrice;
    legs.push({
      kind: "book",
      makerOrderId: ask.id,
      makerUserId: ask.userId,
      price: ask.limitPrice,
      shares: takeShares,
      coins: takeCoins,
    });
    totalShares += takeShares;
    coinsLeft -= takeCoins;
  }

  // Any remainder goes through the AMM.
  if (coinsLeft > 0) {
    const ammQuote = quoteBuy(reserves, input.outcome, coinsLeft);
    if (!ammQuote) {
      // AMM refused the remaining size (slippage guard, etc.). If the book
      // gave us anything, return what we have — the caller can decide. If
      // we got nothing at all, the trade is infeasible.
      if (legs.length === 0) return null;
      return finaliseBuy(input, legs, totalShares, input.coins - coinsLeft);
    }
    legs.push({
      kind: "amm",
      input: coinsLeft,
      output: ammQuote.sharesOut,
      newReserves: ammQuote.newReserves,
    });
    totalShares += ammQuote.sharesOut;
    reserves = ammQuote.newReserves;
    coinsLeft = 0;
  }

  return finaliseBuy(input, legs, totalShares, input.coins - coinsLeft);
}

function finaliseBuy(
  input: RouteBuyInput,
  legs: PlanLeg[],
  totalShares: number,
  totalCoins: number,
): BuyPlan | null {
  if (totalShares <= 0 || totalCoins <= 0) return null;
  return {
    side: "BUY",
    outcome: input.outcome,
    totalCoins,
    totalShares,
    avgPrice: totalCoins / totalShares,
    legs,
  };
}

/**
 * Plan a smart SELL. Mirror of `routeBuy`: walk resting BUYs descending
 * while their price is above the AMM marginal, sweep the rest into the AMM.
 */
export function routeSell(input: RouteSellInput): SellPlan | null {
  if (input.shares <= 0) return null;

  let sharesLeft = input.shares;
  let reserves = { ...input.reserves };
  const legs: PlanLeg[] = [];
  let totalCoins = 0;

  const bids = input.resting
    .filter((o) => o.userId !== input.takerUserId && o.remaining > 1e-9)
    .sort((a, b) => b.limitPrice - a.limitPrice);

  for (const bid of bids) {
    if (sharesLeft <= 0) break;
    const ammPrice = ammMarginal(reserves, input.outcome);
    // Stop walking once book bid is at-or-below AMM marginal — AMM pays
    // better from here.
    if (bid.limitPrice <= ammPrice + 1e-9) break;

    const takeShares = Math.min(sharesLeft, bid.remaining);
    if (takeShares <= 0) continue;
    const takeCoins = takeShares * bid.limitPrice;
    legs.push({
      kind: "book",
      makerOrderId: bid.id,
      makerUserId: bid.userId,
      price: bid.limitPrice,
      shares: takeShares,
      coins: takeCoins,
    });
    totalCoins += takeCoins;
    sharesLeft -= takeShares;
  }

  if (sharesLeft > 0) {
    const ammQuote = quoteSell(reserves, input.outcome, sharesLeft);
    if (!ammQuote) {
      if (legs.length === 0) return null;
      return finaliseSell(input, legs, totalCoins, input.shares - sharesLeft);
    }
    legs.push({
      kind: "amm",
      input: sharesLeft,
      output: ammQuote.coinsOut,
      newReserves: ammQuote.newReserves,
    });
    totalCoins += ammQuote.coinsOut;
    reserves = ammQuote.newReserves;
    sharesLeft = 0;
  }

  return finaliseSell(input, legs, totalCoins, input.shares - sharesLeft);
}

function finaliseSell(
  input: RouteSellInput,
  legs: PlanLeg[],
  totalCoins: number,
  totalShares: number,
): SellPlan | null {
  if (totalShares <= 0 || totalCoins <= 0) return null;
  return {
    side: "SELL",
    outcome: input.outcome,
    totalShares,
    totalCoins,
    avgPrice: totalCoins / totalShares,
    legs,
  };
}
