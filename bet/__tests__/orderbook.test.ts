import { describe, expect, it } from "vitest";
import {
  buildLadder,
  matchIncoming,
  snapPrice,
  snapShares,
  type RestingOrder,
} from "@/lib/orderbook";

function ask(
  id: string,
  user: string,
  price: number,
  qty: number,
  createdAt = 0,
): RestingOrder {
  return { id, userId: user, side: "SELL", limitPrice: price, remaining: qty, createdAt };
}
function bid(
  id: string,
  user: string,
  price: number,
  qty: number,
  createdAt = 0,
): RestingOrder {
  return { id, userId: user, side: "BUY", limitPrice: price, remaining: qty, createdAt };
}

describe("snapPrice / snapShares", () => {
  it("snaps prices to 2dp inside (0.01, 0.99)", () => {
    expect(snapPrice(0.1234)).toBe(0.12);
    expect(snapPrice(0.001)).toBe(0.01);
    expect(snapPrice(0.9999)).toBe(0.99);
  });
  it("rejects invalid inputs", () => {
    expect(Number.isNaN(snapPrice(NaN))).toBe(true);
    expect(Number.isNaN(snapShares(-1))).toBe(true);
  });
});

describe("matchIncoming — BUY taker", () => {
  it("crosses against cheapest asks first", () => {
    const resting = [
      ask("a1", "u1", 0.50, 20),
      ask("a2", "u1", 0.40, 30),
      ask("a3", "u1", 0.45, 50),
    ];
    const m = matchIncoming(
      { userId: "buyer", side: "BUY", limitPrice: 0.50, shares: 60 },
      resting,
    );
    // Should hit 0.40 first (30 shares), then 0.45 (30 shares).
    expect(m.fills.length).toBe(2);
    expect(m.fills[0].price).toBe(0.40);
    expect(m.fills[0].shares).toBe(30);
    expect(m.fills[1].price).toBe(0.45);
    expect(m.fills[1].shares).toBe(30);
    expect(m.remaining).toBe(0);
  });

  it("stops at the taker's limit (price improvement to taker, not maker)", () => {
    const resting = [ask("a1", "u1", 0.40, 20), ask("a2", "u1", 0.55, 30)];
    const m = matchIncoming(
      { userId: "buyer", side: "BUY", limitPrice: 0.50, shares: 100 },
      resting,
    );
    // 0.40 ask crosses (≤ 0.50), 0.55 doesn't. 80 shares left unfilled.
    expect(m.fills.length).toBe(1);
    expect(m.fills[0].price).toBe(0.40);
    expect(m.remaining).toBe(80);
  });

  it("skips own resting orders (self-trade prevention)", () => {
    const resting = [ask("a1", "self", 0.40, 100)];
    const m = matchIncoming(
      { userId: "self", side: "BUY", limitPrice: 0.50, shares: 50 },
      resting,
    );
    expect(m.fills.length).toBe(0);
    expect(m.remaining).toBe(50);
  });

  it("ignores opposite-side orders that slip into the pool", () => {
    // A bug elsewhere passing same-side rows should never produce a fill.
    const m = matchIncoming(
      { userId: "buyer", side: "BUY", limitPrice: 0.99, shares: 50 },
      [bid("b1", "u1", 0.10, 100)],
    );
    expect(m.fills).toEqual([]);
  });

  it("time priority breaks ties at the same price", () => {
    const resting = [
      ask("late", "u2", 0.40, 10, 2_000),
      ask("early", "u1", 0.40, 10, 1_000),
    ];
    const m = matchIncoming(
      { userId: "buyer", side: "BUY", limitPrice: 0.50, shares: 5 },
      resting,
    );
    expect(m.fills[0].makerOrderId).toBe("early");
  });
});

describe("matchIncoming — SELL taker", () => {
  it("crosses against highest bids first", () => {
    const resting = [
      bid("b1", "u1", 0.30, 20),
      bid("b2", "u1", 0.55, 10),
      bid("b3", "u1", 0.40, 25),
    ];
    const m = matchIncoming(
      { userId: "seller", side: "SELL", limitPrice: 0.35, shares: 30 },
      resting,
    );
    // 0.55 first (10), then 0.40 (20). 0.30 stops (< 0.35 ask).
    expect(m.fills[0].price).toBe(0.55);
    expect(m.fills[0].shares).toBe(10);
    expect(m.fills[1].price).toBe(0.40);
    expect(m.fills[1].shares).toBe(20);
    expect(m.remaining).toBe(0);
  });
});

describe("buildLadder", () => {
  it("aggregates bids descending and asks ascending", () => {
    const orders: RestingOrder[] = [
      bid("b1", "u1", 0.40, 50),
      bid("b2", "u2", 0.42, 30),
      bid("b3", "u3", 0.40, 20),
      ask("a1", "u1", 0.55, 100),
      ask("a2", "u2", 0.50, 25),
    ];
    const lad = buildLadder(orders);
    expect(lad.bids[0]).toEqual({ price: 0.42, shares: 30 });
    // 0.40 bid level aggregates b1 + b3.
    expect(lad.bids[1]).toEqual({ price: 0.40, shares: 70 });
    expect(lad.asks[0]).toEqual({ price: 0.50, shares: 25 });
    expect(lad.bestBid).toBe(0.42);
    expect(lad.bestAsk).toBe(0.50);
  });
});
