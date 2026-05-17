import { describe, expect, it } from "vitest";
import { routeBuy, routeSell, type RestingOrder } from "@/lib/router";
import { priceYes } from "@/lib/amm";

function ask(id: string, user: string, price: number, qty: number): RestingOrder {
  return { id, userId: user, limitPrice: price, remaining: qty };
}
function bid(id: string, user: string, price: number, qty: number): RestingOrder {
  return { id, userId: user, limitPrice: price, remaining: qty };
}

/**
 * Smart-router planner tests. Use a YES-heavy pool so the AMM marginal is
 * known (≈0.59 for 800/1170) and we can construct asks above/below that
 * predictably.
 */
describe("routeBuy", () => {
  it("AMM-only when the book has no crossing asks", () => {
    const reserves = { yesShares: 1000, noShares: 1000 };
    const plan = routeBuy({
      takerUserId: "buyer",
      outcome: "YES",
      coins: 100,
      reserves,
      resting: [ask("a1", "maker", 0.60, 50)], // above marginal 0.50 — not useful
    })!;
    expect(plan.legs.length).toBe(1);
    expect(plan.legs[0].kind).toBe("amm");
  });

  it("walks the book while levels beat the AMM marginal, then sweeps AMM", () => {
    const reserves = { yesShares: 1000, noShares: 1000 }; // marginal YES = 0.5
    const plan = routeBuy({
      takerUserId: "buyer",
      outcome: "YES",
      coins: 100,
      reserves,
      resting: [
        ask("cheap", "m1", 0.20, 50), // 50 shares × 0.20 = 10 coins
        ask("ok",    "m1", 0.40, 50), // 50 × 0.40 = 20 coins
        ask("dear",  "m1", 0.70, 50), // above AMM marginal → never taken
      ],
    })!;
    // Two book legs (the cheap and ok asks), one AMM sweep for the
    // remainder.
    const bookLegs = plan.legs.filter((l) => l.kind === "book");
    const ammLegs = plan.legs.filter((l) => l.kind === "amm");
    expect(bookLegs.length).toBe(2);
    expect(bookLegs[0].price).toBe(0.20);
    expect(bookLegs[1].price).toBe(0.40);
    expect(ammLegs.length).toBe(1);
    expect(plan.totalCoins).toBe(100);
  });

  it("skips own resting orders (self-trade prevention)", () => {
    const reserves = { yesShares: 1000, noShares: 1000 };
    const plan = routeBuy({
      takerUserId: "self",
      outcome: "YES",
      coins: 30,
      reserves,
      resting: [ask("a1", "self", 0.10, 50)], // own — must be ignored
    })!;
    expect(plan.legs.every((l) => l.kind === "amm")).toBe(true);
  });

  it("beats AMM-only when cheaper makers are present", () => {
    // Apples-to-apples: route vs pure AMM at the same reserves and size.
    const reserves = { yesShares: 1000, noShares: 1000 };
    const cheapAsk = [ask("cheap", "m1", 0.20, 50)];
    const routed = routeBuy({
      takerUserId: "buyer",
      outcome: "YES",
      coins: 100,
      reserves,
      resting: cheapAsk,
    })!;
    const ammOnly = routeBuy({
      takerUserId: "buyer",
      outcome: "YES",
      coins: 100,
      reserves,
      resting: [], // empty book → pure AMM
    })!;
    expect(routed.totalShares).toBeGreaterThan(ammOnly.totalShares);
    expect(routed.avgPrice).toBeLessThan(ammOnly.avgPrice);
  });

  it("returns null when the trade is infeasible (slippage guard + empty book)", () => {
    // 1M coins on a thin 100/100 pool: AMM refuses, no book to fall back on.
    const plan = routeBuy({
      takerUserId: "buyer",
      outcome: "YES",
      coins: 1_000_000,
      reserves: { yesShares: 100, noShares: 100 },
      resting: [],
    });
    expect(plan).toBeNull();
  });

  it("recomputes AMM marginal as the book is taken (no premature switch)", () => {
    const reserves = { yesShares: 1000, noShares: 1000 };
    // Two asks both currently below AMM marginal. After the first fills, the
    // implicit AMM marginal at the now-shrunken effective trade size hasn't
    // moved (we haven't touched the AMM yet) — so the second ask still
    // crosses. The router must NOT prematurely flip to AMM after one fill.
    const plan = routeBuy({
      takerUserId: "buyer",
      outcome: "YES",
      coins: 200,
      reserves,
      resting: [
        ask("first",  "m1", 0.30, 100), // 30 coins for 100 sh
        ask("second", "m1", 0.45, 100), // 45 coins for 100 sh; still < 0.5
      ],
    })!;
    const bookLegs = plan.legs.filter((l) => l.kind === "book");
    expect(bookLegs.length).toBe(2);
  });
});

describe("routeSell", () => {
  it("walks bids descending while they pay better than AMM marginal", () => {
    const reserves = { yesShares: 1000, noShares: 1000 }; // YES marginal 0.5
    const plan = routeSell({
      takerUserId: "seller",
      outcome: "YES",
      shares: 80,
      reserves,
      resting: [
        bid("hi", "m1", 0.80, 30),  // best
        bid("mid", "m1", 0.60, 30), // still > 0.5
        bid("low", "m1", 0.30, 50), // below AMM — never taken
      ],
    })!;
    const bookLegs = plan.legs.filter((l) => l.kind === "book");
    expect(bookLegs.length).toBe(2);
    expect(bookLegs[0].price).toBe(0.80);
    expect(bookLegs[1].price).toBe(0.60);
    // Total = 30 (book 0.80) + 30 (book 0.60) + 20 (AMM) = 80
    expect(plan.totalShares).toBe(80);
  });
});

describe("priceYes invariant cross-check (sanity)", () => {
  it("after a YES buy via the router the implied marginal rises", () => {
    const reserves = { yesShares: 1000, noShares: 1000 };
    const plan = routeBuy({
      takerUserId: "buyer",
      outcome: "YES",
      coins: 200,
      reserves,
      resting: [],
    })!;
    const ammLeg = plan.legs.find((l) => l.kind === "amm")!;
    if (ammLeg.kind !== "amm") return;
    const newMarginal = priceYes(ammLeg.newReserves);
    expect(newMarginal).toBeGreaterThan(0.5);
  });
});
