/**
 * Pure orderbook matching engine. No DB access. The route handler loads the
 * resting orders, calls `matchIncoming`, persists the resulting fills and
 * order updates in one Postgres transaction.
 *
 * Model: a binary-outcome market has one orderbook per outcome (YES or NO),
 * with BUYs and SELLs on the same side of the same outcome quoted in price
 * 0..1. A BUY at p means "I'll pay up to p coins for one share that pays 1
 * if this outcome resolves true". A SELL at p means "I'll deliver one share
 * for at least p coins". They cross when buyPrice >= sellPrice.
 *
 * Matching policy: price-time priority. The taker (incoming order) pays the
 * resting maker's price — price improvement passes back to the taker. Self-
 * trades are skipped (an order doesn't match against its own user's resting
 * orders) so users can't manipulate their P/L with wash trades.
 */

export type OrderSide = "BUY" | "SELL";
export type Outcome = "YES" | "NO";

export interface RestingOrder {
  id: string;
  userId: string;
  side: OrderSide;
  limitPrice: number;
  remaining: number;
  createdAt: Date | number;
}

export interface IncomingOrder {
  userId: string;
  side: OrderSide;
  limitPrice: number;
  shares: number;
}

export interface Fill {
  /** The resting order that filled. */
  makerOrderId: string;
  makerUserId: string;
  /** Fill price (the resting maker's price). */
  price: number;
  /** Shares exchanged in this fill. */
  shares: number;
}

export interface MatchResult {
  fills: Fill[];
  /** Shares of the incoming order that did NOT match. */
  remaining: number;
  /** Total coins the taker paid (BUY) or received (SELL). */
  cost: number;
}

/** Sort comparator: BUYs descending by price, SELLs ascending. Time as tiebreak. */
function bestFirst(side: OrderSide) {
  return (a: RestingOrder, b: RestingOrder) => {
    if (side === "BUY") {
      // For a BUY taker we want the cheapest SELLs first.
      if (a.limitPrice !== b.limitPrice) return a.limitPrice - b.limitPrice;
    } else {
      // SELL taker wants the most-expensive BUYs first.
      if (a.limitPrice !== b.limitPrice) return b.limitPrice - a.limitPrice;
    }
    const at = a.createdAt instanceof Date ? a.createdAt.getTime() : a.createdAt;
    const bt = b.createdAt instanceof Date ? b.createdAt.getTime() : b.createdAt;
    return at - bt;
  };
}

/**
 * Match `incoming` against the array of `resting` orders. `resting` is the
 * pool of orders on the OPPOSITE side from the incoming order (so a BUY
 * taker matches SELL makers, and vice versa).
 *
 * `resting` is mutated in place — fills decrement `remaining`, fully-filled
 * makers are kept in the array with `remaining = 0` so the caller can
 * persist their FILLED state.
 */
export function matchIncoming(
  incoming: IncomingOrder,
  resting: RestingOrder[],
): MatchResult {
  // Defensive: callers should only pass us opposite-side resting orders. If
  // someone slips a same-side order in, skip it — it can never cross.
  const oppositeSide: OrderSide = incoming.side === "BUY" ? "SELL" : "BUY";
  const candidates = resting
    .filter((o) => o.side === oppositeSide && o.remaining > 0 && o.userId !== incoming.userId)
    .sort(bestFirst(incoming.side));

  let remaining = incoming.shares;
  let cost = 0;
  const fills: Fill[] = [];

  for (const maker of candidates) {
    if (remaining <= 0) break;
    if (!crosses(incoming, maker)) break; // sorted by price → no further match possible
    const filledShares = Math.min(remaining, maker.remaining);
    if (filledShares <= 0) continue;
    fills.push({
      makerOrderId: maker.id,
      makerUserId: maker.userId,
      price: maker.limitPrice,
      shares: filledShares,
    });
    cost += filledShares * maker.limitPrice;
    remaining -= filledShares;
    maker.remaining -= filledShares;
  }

  return { fills, remaining, cost };
}

function crosses(taker: IncomingOrder, maker: RestingOrder): boolean {
  if (taker.side === "BUY") {
    // taker.limit ≥ maker.limit → buyer willing to pay at least the seller's ask
    return taker.limitPrice + 1e-9 >= maker.limitPrice;
  }
  return maker.limitPrice + 1e-9 >= taker.limitPrice;
}

/**
 * Aggregated ladder view (price → shares) for the UI. Bids and asks are
 * separate arrays sorted from best to worst.
 */
export interface LadderRow {
  price: number;
  shares: number;
}
export interface Ladder {
  bids: LadderRow[];
  asks: LadderRow[];
  bestBid: number | null;
  bestAsk: number | null;
}

export function buildLadder(resting: RestingOrder[]): Ladder {
  const bids = new Map<number, number>();
  const asks = new Map<number, number>();
  for (const o of resting) {
    if (o.remaining <= 0) continue;
    const map = o.side === "BUY" ? bids : asks;
    map.set(o.limitPrice, (map.get(o.limitPrice) ?? 0) + o.remaining);
  }
  const bidsArr = [...bids.entries()]
    .map(([price, shares]) => ({ price, shares }))
    .sort((a, b) => b.price - a.price);
  const asksArr = [...asks.entries()]
    .map(([price, shares]) => ({ price, shares }))
    .sort((a, b) => a.price - b.price);
  return {
    bids: bidsArr,
    asks: asksArr,
    bestBid: bidsArr[0]?.price ?? null,
    bestAsk: asksArr[0]?.price ?? null,
  };
}

/**
 * Normalise a price to 0.01 .. 0.99 with 2 decimal places. Markets reject
 * orders outside this band to avoid degenerate fills at the 0 and 1
 * boundaries (resolved markets) and to make ladder rendering predictable.
 */
export function snapPrice(p: number): number {
  if (!Number.isFinite(p)) return NaN;
  const clamped = Math.min(0.99, Math.max(0.01, p));
  return Math.round(clamped * 100) / 100;
}

/** Treat fractional shares as 4-decimal — keeps ledger arithmetic stable. */
export function snapShares(s: number): number {
  if (!Number.isFinite(s) || s <= 0) return NaN;
  return Math.round(s * 10_000) / 10_000;
}
