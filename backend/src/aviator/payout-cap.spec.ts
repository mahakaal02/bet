import {
  DEFAULT_PAYOUT_CAP_COINS,
  DEFAULT_PAYOUT_CAP_ENABLED,
  PAYOUT_CAP_KEY_ENABLED,
  PAYOUT_CAP_KEY_MAX_COINS,
  applyPayoutCap,
  capMultiplier,
  isCapActive,
  loadCapConfig,
  type PayoutCapConfig,
  type SettingsReader,
} from './payout-cap';

/**
 * Pure-function tests for the payout-cap helpers. No DI, no mocks
 * beyond a tiny SettingsReader stub. The wired-in behaviour (DB
 * column persistence, websocket emission, tick-loop integration) is
 * exercised separately in `aviator.service.spec.ts` once Commits 3+
 * land.
 */

const ON: PayoutCapConfig = { enabled: true, maxCoins: 20_000 };
const OFF: PayoutCapConfig = { enabled: false, maxCoins: 20_000 };

describe('applyPayoutCap — below cap (un-capped path)', () => {
  it('returns the raw floor-ed payout when payout < cap', () => {
    // stake=100, multiplier=2.45 → 245 coins
    expect(applyPayoutCap(100, 2.45, ON)).toEqual({
      payout: 245,
      originalPayout: 245,
      capped: false,
      // Cap is recorded even on un-capped wins so audits can
      // answer "what cap was in force when this row settled?".
      appliedCapCoins: 20_000,
    });
  });

  it('floors fractional payouts (no precision drift)', () => {
    // 100 * 1.999 = 199.9 → 199
    expect(applyPayoutCap(100, 1.999, ON)).toMatchObject({
      payout: 199,
      capped: false,
    });
    // 7 * 1.43 = 10.01 → 10
    expect(applyPayoutCap(7, 1.43, ON)).toMatchObject({ payout: 10 });
  });

  it('returns the bet amount unchanged at 1.0× cashout', () => {
    expect(applyPayoutCap(500, 1.0, ON)).toMatchObject({
      payout: 500,
      capped: false,
    });
  });
});

describe('applyPayoutCap — exactly at cap', () => {
  it('does NOT mark as capped when payout == cap', () => {
    // 100 * 200 = 20000 = cap → no clip needed, capped: false
    expect(applyPayoutCap(100, 200, ON)).toEqual({
      payout: 20_000,
      originalPayout: 20_000,
      capped: false,
      appliedCapCoins: 20_000,
    });
  });

  it('marks as capped the instant payout exceeds cap by 1 coin', () => {
    // 100 * 200.01 = 20001 → cap fires
    const r = applyPayoutCap(100, 200.01, ON);
    expect(r.capped).toBe(true);
    expect(r.payout).toBe(20_000);
    expect(r.originalPayout).toBe(20_001);
  });
});

describe('applyPayoutCap — above cap (clipped path)', () => {
  it('clips a 500× round on a ₹100 bet to ₹20 000', () => {
    // 100 * 500 = 50000 → clipped to 20000
    expect(applyPayoutCap(100, 500, ON)).toEqual({
      payout: 20_000,
      originalPayout: 50_000,
      capped: true,
      appliedCapCoins: 20_000,
    });
  });

  it('clips a 1000× round on a ₹500 bet', () => {
    // 500 * 1000 = 500000 → clipped to 20000
    expect(applyPayoutCap(500, 1_000, ON)).toMatchObject({
      payout: 20_000,
      originalPayout: 500_000,
      capped: true,
    });
  });

  it('clips an absurd 1M× edge-case multiplier without overflow', () => {
    const r = applyPayoutCap(1_000_000, 1_000_000, ON);
    expect(r.payout).toBe(20_000);
    // Raw = 1e12 — Number.isFinite still true; no overflow drama.
    expect(r.originalPayout).toBe(1_000_000_000_000);
    expect(r.capped).toBe(true);
  });
});

describe('applyPayoutCap — cap disabled / null / zero', () => {
  it('passes through when cap is disabled', () => {
    expect(applyPayoutCap(100, 500, OFF)).toEqual({
      payout: 50_000,
      originalPayout: 50_000,
      capped: false,
      // No cap recorded because none was active.
      appliedCapCoins: null,
    });
  });

  it('treats maxCoins=0 as no-op (fail-safe)', () => {
    const cfg = { enabled: true, maxCoins: 0 };
    expect(applyPayoutCap(100, 500, cfg)).toMatchObject({
      payout: 50_000,
      capped: false,
      appliedCapCoins: null,
    });
  });

  it('treats negative maxCoins as no-op', () => {
    expect(
      applyPayoutCap(100, 500, { enabled: true, maxCoins: -1 }),
    ).toMatchObject({ payout: 50_000, capped: false });
  });

  it('treats NaN / Infinity maxCoins as no-op', () => {
    expect(
      applyPayoutCap(100, 500, { enabled: true, maxCoins: NaN }),
    ).toMatchObject({ capped: false });
    expect(
      applyPayoutCap(100, 500, { enabled: true, maxCoins: Infinity }),
    ).toMatchObject({ capped: false });
  });
});

describe('applyPayoutCap — defensive on garbage input', () => {
  it('returns zero payout for stake <= 0', () => {
    expect(applyPayoutCap(0, 5, ON)).toMatchObject({ payout: 0, capped: false });
    expect(applyPayoutCap(-10, 5, ON)).toMatchObject({ payout: 0 });
  });

  it('returns zero payout for multiplier < 1', () => {
    expect(applyPayoutCap(100, 0.5, ON)).toMatchObject({ payout: 0 });
    expect(applyPayoutCap(100, 0, ON)).toMatchObject({ payout: 0 });
  });

  it('returns zero payout for non-finite stake / multiplier', () => {
    expect(applyPayoutCap(NaN, 5, ON)).toMatchObject({ payout: 0 });
    expect(applyPayoutCap(100, NaN, ON)).toMatchObject({ payout: 0 });
    expect(applyPayoutCap(100, Infinity, ON)).toMatchObject({ payout: 0 });
  });
});

describe('capMultiplier — exact line where the cap fires', () => {
  it('computes the multiplier that makes payout == cap', () => {
    // 20000 / 100 = 200 — so a ₹100 stake hits the ₹20k cap at exactly 200×
    expect(capMultiplier(100, 20_000)).toBe(200);
    // 20000 / 500 = 40
    expect(capMultiplier(500, 20_000)).toBe(40);
    // 20000 / 20000 = 1 — a ₹20k stake hits the cap at takeoff
    expect(capMultiplier(20_000, 20_000)).toBe(1);
  });

  it('returns Infinity for stake <= 0 (never fires)', () => {
    expect(capMultiplier(0, 20_000)).toBe(Number.POSITIVE_INFINITY);
    expect(capMultiplier(-1, 20_000)).toBe(Number.POSITIVE_INFINITY);
  });

  it('returns Infinity for cap <= 0 (never fires)', () => {
    expect(capMultiplier(100, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(capMultiplier(100, -50)).toBe(Number.POSITIVE_INFINITY);
  });

  it('returns Infinity for non-finite inputs', () => {
    expect(capMultiplier(NaN, 20_000)).toBe(Number.POSITIVE_INFINITY);
    expect(capMultiplier(100, NaN)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('isCapActive predicate', () => {
  it.each<[PayoutCapConfig, boolean]>([
    [{ enabled: true, maxCoins: 20_000 }, true],
    [{ enabled: false, maxCoins: 20_000 }, false],
    [{ enabled: true, maxCoins: 0 }, false],
    [{ enabled: true, maxCoins: -1 }, false],
    [{ enabled: true, maxCoins: NaN }, false],
    [{ enabled: true, maxCoins: Infinity }, false],
  ])('isCapActive(%j) === %j', (cfg, expected) => {
    expect(isCapActive(cfg)).toBe(expected);
  });
});

describe('loadCapConfig — SettingsService fallback chain', () => {
  function makeReader(boolMap: Record<string, boolean>, intMap: Record<string, number>): SettingsReader {
    return {
      async getBool(key, fallback) {
        return key in boolMap ? boolMap[key] : fallback;
      },
      async getInt(key, fallback) {
        return key in intMap ? intMap[key] : fallback;
      },
    };
  }

  it('uses default values when no rows exist', async () => {
    const reader = makeReader({}, {});
    expect(await loadCapConfig(reader)).toEqual({
      enabled: DEFAULT_PAYOUT_CAP_ENABLED,
      maxCoins: DEFAULT_PAYOUT_CAP_COINS,
    });
  });

  it('reads admin-configured values when present', async () => {
    const reader = makeReader(
      { [PAYOUT_CAP_KEY_ENABLED]: false },
      { [PAYOUT_CAP_KEY_MAX_COINS]: 50_000 },
    );
    expect(await loadCapConfig(reader)).toEqual({
      enabled: false,
      maxCoins: 50_000,
    });
  });

  it('coerces non-positive maxCoins to the default (fail-safe)', async () => {
    const reader = makeReader(
      { [PAYOUT_CAP_KEY_ENABLED]: true },
      { [PAYOUT_CAP_KEY_MAX_COINS]: -1 },
    );
    const cfg = await loadCapConfig(reader);
    expect(cfg.maxCoins).toBe(DEFAULT_PAYOUT_CAP_COINS);
  });

  it('coerces non-finite maxCoins to the default', async () => {
    const reader = makeReader(
      { [PAYOUT_CAP_KEY_ENABLED]: true },
      { [PAYOUT_CAP_KEY_MAX_COINS]: NaN },
    );
    expect((await loadCapConfig(reader)).maxCoins).toBe(DEFAULT_PAYOUT_CAP_COINS);
  });

  it('floors fractional maxCoins (defensive)', async () => {
    const reader = makeReader(
      { [PAYOUT_CAP_KEY_ENABLED]: true },
      { [PAYOUT_CAP_KEY_MAX_COINS]: 25_000.7 },
    );
    expect((await loadCapConfig(reader)).maxCoins).toBe(25_000);
  });
});

describe('applyPayoutCap — fuzz: integer-math invariants', () => {
  it('payout never exceeds cap when enabled and active (1k random)', () => {
    for (let i = 0; i < 1_000; i++) {
      const stake = 1 + Math.floor(Math.random() * 100_000);
      const mult = 1 + Math.random() * 1_000;
      const cap = 1 + Math.floor(Math.random() * 100_000);
      const r = applyPayoutCap(stake, mult, { enabled: true, maxCoins: cap });
      expect(r.payout).toBeLessThanOrEqual(cap);
      expect(r.payout).toBeGreaterThanOrEqual(0);
      // Integer in, integer out — no floats leaking through.
      expect(Number.isInteger(r.payout)).toBe(true);
      expect(Number.isInteger(r.originalPayout)).toBe(true);
    }
  });

  it('uncapped payout == capped payout when cap disabled (1k random)', () => {
    for (let i = 0; i < 1_000; i++) {
      const stake = 1 + Math.floor(Math.random() * 100_000);
      const mult = 1 + Math.random() * 1_000;
      const onR = applyPayoutCap(stake, mult, { enabled: false, maxCoins: 20_000 });
      const expectedRaw = Math.floor(stake * mult);
      expect(onR.payout).toBe(expectedRaw);
      expect(onR.capped).toBe(false);
    }
  });
});
