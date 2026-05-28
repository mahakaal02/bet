import { describe, expect, it } from "vitest";
import {
  childYesPrice,
  groupDisplayPrices,
  normalizeGroupPrices,
  rawGroupPrices,
} from "@/lib/market-group";

const sum = (xs: { normalizedPct: number }[]) =>
  xs.reduce((s, c) => s + c.normalizedPct, 0);

describe("normalizeGroupPrices (EXCLUSIVE)", () => {
  it("returns [] for no children", () => {
    expect(normalizeGroupPrices([])).toEqual([]);
  });

  it("single child gets 100%", () => {
    const out = normalizeGroupPrices([{ marketId: "a", yesPrice: 0.42 }]);
    expect(out).toEqual([{ marketId: "a", yesPrice: 0.42, normalizedPct: 100 }]);
  });

  it("always sums to exactly 100", () => {
    const cases = [
      [0.5, 0.5],
      [0.6, 0.3, 0.3], // raw prices need not sum to 1
      [0.33, 0.33, 0.33],
      [0.7, 0.2, 0.05, 0.05],
      [0.11, 0.13, 0.17, 0.19, 0.23],
    ];
    for (const prices of cases) {
      const out = normalizeGroupPrices(
        prices.map((p, i) => ({ marketId: String(i), yesPrice: p })),
      );
      expect(sum(out)).toBe(100);
    }
  });

  it("ranks by raw price (higher price → higher normalized pct)", () => {
    const out = normalizeGroupPrices([
      { marketId: "low", yesPrice: 0.1 },
      { marketId: "high", yesPrice: 0.6 },
      { marketId: "mid", yesPrice: 0.3 },
    ]);
    const by = Object.fromEntries(out.map((c) => [c.marketId, c.normalizedPct]));
    expect(by.high).toBeGreaterThan(by.mid);
    expect(by.mid).toBeGreaterThan(by.low);
  });

  it("preserves input order in the output array", () => {
    const out = normalizeGroupPrices([
      { marketId: "x", yesPrice: 0.1 },
      { marketId: "y", yesPrice: 0.6 },
    ]);
    expect(out.map((c) => c.marketId)).toEqual(["x", "y"]);
  });

  it("zero-sum guard: even split that still sums to 100", () => {
    const out = normalizeGroupPrices([
      { marketId: "a", yesPrice: 0 },
      { marketId: "b", yesPrice: 0 },
      { marketId: "c", yesPrice: 0 },
    ]);
    expect(sum(out)).toBe(100);
    // 100/3 → 34/33/33 in some order
    expect(out.map((c) => c.normalizedPct).sort()).toEqual([33, 33, 34]);
  });

  it("ignores negative/NaN prices safely", () => {
    const out = normalizeGroupPrices([
      { marketId: "a", yesPrice: 0.5 },
      { marketId: "b", yesPrice: Number.NaN },
      { marketId: "c", yesPrice: -1 },
    ]);
    expect(sum(out)).toBe(100);
    expect(out[0].normalizedPct).toBe(100);
  });
});

describe("rawGroupPrices (INDEPENDENT)", () => {
  it("passes through raw YES% without cross-normalization", () => {
    const out = rawGroupPrices([
      { marketId: "a", yesPrice: 0.6 },
      { marketId: "b", yesPrice: 0.6 },
    ]);
    expect(out.map((c) => c.normalizedPct)).toEqual([60, 60]); // need not sum to 100
  });
});

describe("groupDisplayPrices", () => {
  it("normalizes when exclusive, passes through otherwise", () => {
    const children = [
      { marketId: "a", yesPrice: 0.6 },
      { marketId: "b", yesPrice: 0.6 },
    ];
    expect(sum(groupDisplayPrices(children, true))).toBe(100);
    expect(sum(groupDisplayPrices(children, false))).toBe(120);
  });
});

describe("childYesPrice", () => {
  it("mirrors the AMM formula", () => {
    expect(childYesPrice({ yesShares: 1000, noShares: 1000 })).toBeCloseTo(0.5, 6);
    expect(childYesPrice({ yesShares: 200, noShares: 800 })).toBeCloseTo(0.8, 6);
  });
});
