import { describe, expect, it } from "vitest";
import { priceYes, quoteBuy, quoteSell } from "@/lib/amm";

/**
 * Pure-math tests for the AMM. These tripled-up bookkeeping concerns —
 * the post-fix "split-coin" formula, the round-trip invariant, the
 * slippage guards — are the part of the system most expensive to get
 * wrong, so we lock them down here.
 *
 * No DB, no Prisma. Replicates and extends scripts/amm-sanity.ts.
 */
describe("priceYes", () => {
  it("returns 0.5 at 50/50 reserves", () => {
    expect(priceYes({ yesShares: 1000, noShares: 1000 })).toBeCloseTo(0.5, 6);
  });
  it("yes-heavy pool → low YES price", () => {
    expect(priceYes({ yesShares: 4000, noShares: 1000 })).toBeCloseTo(0.2, 6);
  });
  it("no-heavy pool → high YES price", () => {
    expect(priceYes({ yesShares: 200, noShares: 800 })).toBeCloseTo(0.8, 6);
  });
});

describe("quoteBuy", () => {
  it("rejects zero / negative coins", () => {
    const r = { yesShares: 1000, noShares: 1000 };
    expect(quoteBuy(r, "YES", 0)).toBeNull();
    expect(quoteBuy(r, "YES", -1)).toBeNull();
  });

  it("avg price is always between marginal_before and 1", () => {
    const r = { yesShares: 1000, noShares: 1000 };
    for (const c of [1, 10, 100, 1000, 5000]) {
      const q = quoteBuy(r, "YES", c);
      if (!q) continue;
      expect(q.avgPrice).toBeGreaterThan(0.5);
      expect(q.avgPrice).toBeLessThan(1);
    }
  });

  it("1000 coins at 50/50 yields ≈1487 shares (split + transfer)", () => {
    // Canonical example from the fix commit. Anchors the formula against a
    // human-computed answer so a future regression in either term shows up.
    const r = { yesShares: 1000, noShares: 1000 };
    const q = quoteBuy(r, "YES", 1000)!;
    expect(q.sharesOut).toBeCloseTo(1487.49, 1);
    expect(q.avgPrice).toBeCloseTo(0.672, 2);
  });

  it("tiny trade → avg ≈ marginal", () => {
    const r = { yesShares: 1000, noShares: 1000 };
    const q = quoteBuy(r, "YES", 1)!;
    expect(Math.abs(q.avgPrice - 0.5)).toBeLessThan(0.01);
  });

  it("slippage guard refuses pool-draining trades", () => {
    expect(quoteBuy({ yesShares: 1000, noShares: 1000 }, "YES", 1_000_000)).toBeNull();
  });

  it("YES buy raises YES marginal, NO buy lowers it", () => {
    const r = { yesShares: 1000, noShares: 1000 };
    const yesBuy = quoteBuy(r, "YES", 100)!;
    const noBuy = quoteBuy(r, "NO", 100)!;
    expect(yesBuy.newYesPrice).toBeGreaterThan(0.5);
    expect(noBuy.newYesPrice).toBeLessThan(0.5);
  });
});

describe("quoteSell", () => {
  it("rejects zero / negative shares", () => {
    const r = { yesShares: 1000, noShares: 1000 };
    expect(quoteSell(r, "YES", 0)).toBeNull();
    expect(quoteSell(r, "YES", -1)).toBeNull();
  });

  it("100 YES at 50/50 yields ≈48 coins (just below marginal)", () => {
    const r = { yesShares: 1000, noShares: 1000 };
    const q = quoteSell(r, "YES", 100)!;
    expect(q.coinsOut).toBeGreaterThan(40);
    expect(q.coinsOut).toBeLessThan(50);
    expect(q.avgPrice).toBeLessThan(0.5);
  });

  it("YES sell lowers YES marginal", () => {
    const r = { yesShares: 1000, noShares: 1000 };
    const q = quoteSell(r, "YES", 100)!;
    expect(q.newYesPrice).toBeLessThan(0.5);
  });

  it("refuses sells that drain the pool below 10% of original", () => {
    // 100k YES dumped into a 1k/1k pool would drag noShares to ~10 (1% of
    // original) — the slippage guard refuses to wreck the user.
    expect(quoteSell({ yesShares: 1000, noShares: 1000 }, "YES", 100_000)).toBeNull();
  });
});

describe("buy → sell round trip", () => {
  it("recovers most of the input but always strictly less (LP fee)", () => {
    const r0 = { yesShares: 1000, noShares: 1000 };
    const buy = quoteBuy(r0, "YES", 1000)!;
    const sell = quoteSell(buy.newReserves, "YES", buy.sharesOut)!;
    expect(sell.coinsOut).toBeLessThan(1000);
    expect(sell.coinsOut).toBeGreaterThan(950);
  });
});
