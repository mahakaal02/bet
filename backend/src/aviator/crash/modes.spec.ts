import { rtpBreakdown } from './distribution';
import {
  DEFAULT_TRACKER_CFG,
  ExposureTracker,
  MODE_PRESETS,
  adaptiveParams,
  blendDistributions,
} from './modes';

describe('crash/modes — presets', () => {
  it('every preset exposes the full DistributionParams shape', () => {
    for (const mode of ['BALANCED', 'FAST_LOSS', 'STREAMER'] as const) {
      const p = MODE_PRESETS[mode];
      expect(p.rtp).toBeGreaterThan(0);
      expect(p.rtp).toBeLessThanOrEqual(1);
      expect(p.bias).toBeGreaterThanOrEqual(0);
      expect(p.biasUpper).toBeGreaterThan(1);
      expect(p.k).toBeGreaterThan(0);
      expect(p.cRef).toBeGreaterThan(1);
      expect(p.maxMultiplier).toBeGreaterThan(1);
    }
  });

  it('FAST_LOSS has more bias mass than BALANCED (house bias)', () => {
    expect(MODE_PRESETS.FAST_LOSS.bias).toBeGreaterThan(MODE_PRESETS.BALANCED.bias);
  });

  it('STREAMER has less bias mass and a fatter tail than BALANCED', () => {
    expect(MODE_PRESETS.STREAMER.bias).toBeLessThan(MODE_PRESETS.BALANCED.bias);
    // Fatter tail = smaller k (closer to 0).
    expect(MODE_PRESETS.STREAMER.k).toBeLessThan(MODE_PRESETS.BALANCED.k);
  });

  it('every preset publishes the same RTP — operator edge mode-invariant', () => {
    const rtp = MODE_PRESETS.BALANCED.rtp;
    expect(MODE_PRESETS.FAST_LOSS.rtp).toBe(rtp);
    expect(MODE_PRESETS.STREAMER.rtp).toBe(rtp);
  });
});

describe('crash/modes — blendDistributions', () => {
  it('t=0 returns the from-set bias/k (RTP fixed by from)', () => {
    const blend = blendDistributions(MODE_PRESETS.BALANCED, MODE_PRESETS.FAST_LOSS, 0);
    expect(blend.bias).toBe(MODE_PRESETS.BALANCED.bias);
    expect(blend.k).toBe(MODE_PRESETS.BALANCED.k);
  });

  it('t=1 returns the to-set bias/k', () => {
    const blend = blendDistributions(MODE_PRESETS.BALANCED, MODE_PRESETS.FAST_LOSS, 1);
    expect(blend.bias).toBeCloseTo(MODE_PRESETS.FAST_LOSS.bias, 6);
    expect(blend.k).toBeCloseTo(MODE_PRESETS.FAST_LOSS.k, 6);
  });

  it('preserves RTP and cRef across the blend (operator invariant)', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const blend = blendDistributions(MODE_PRESETS.BALANCED, MODE_PRESETS.FAST_LOSS, t);
      expect(blend.rtp).toBe(MODE_PRESETS.BALANCED.rtp);
      expect(blend.cRef).toBe(MODE_PRESETS.BALANCED.cRef);
    }
  });

  it('takes the smaller maxMultiplier (more conservative)', () => {
    const a = { ...MODE_PRESETS.BALANCED, maxMultiplier: 100 };
    const b = { ...MODE_PRESETS.STREAMER, maxMultiplier: 1_000 };
    const blend = blendDistributions(a, b, 0.5);
    expect(blend.maxMultiplier).toBe(100);
  });
});

describe('crash/modes — adaptiveParams', () => {
  it('factor=0 returns BALANCED unchanged', () => {
    const { params, mode } = adaptiveParams(MODE_PRESETS.BALANCED, 0);
    expect(mode).toBe('BALANCED');
    expect(params.bias).toBe(MODE_PRESETS.BALANCED.bias);
  });

  it('factor > 0 steers toward FAST_LOSS (more bias mass)', () => {
    const { params, mode } = adaptiveParams(MODE_PRESETS.BALANCED, 0.5);
    expect(mode).toBe('FAST_LOSS');
    expect(params.bias).toBeGreaterThan(MODE_PRESETS.BALANCED.bias);
  });

  it('factor < 0 steers toward STREAMER (less bias mass)', () => {
    const { params, mode } = adaptiveParams(MODE_PRESETS.BALANCED, -0.5);
    expect(mode).toBe('STREAMER');
    expect(params.bias).toBeLessThan(MODE_PRESETS.BALANCED.bias);
  });

  it('RTP at C_ref is preserved across the adaptive blend', () => {
    for (const factor of [-1, -0.5, 0, 0.5, 1]) {
      const { params } = adaptiveParams(MODE_PRESETS.BALANCED, factor);
      const r = rtpBreakdown(params);
      expect(Math.abs(r.atRef - MODE_PRESETS.BALANCED.rtp)).toBeLessThan(1e-6);
    }
  });
});

describe('crash/modes — ExposureTracker', () => {
  function makeTracker() {
    return new ExposureTracker({ ...DEFAULT_TRACKER_CFG, referenceStake: 1_000 });
  }

  it('first record seeds the EMA — subsequent records smooth it', () => {
    const t = makeTracker();
    t.record({ stake: 100, payout: 96, bettors: 1 });
    expect(t.snapshot().smoothedStake).toBe(100);
    t.record({ stake: 200, payout: 190, bettors: 2 });
    expect(t.snapshot().smoothedStake).toBeGreaterThan(100);
    expect(t.snapshot().smoothedStake).toBeLessThan(200);
  });

  it('exposureFactor is positive when stake is much higher than reference', () => {
    const t = makeTracker();
    for (let i = 0; i < 10; i++) {
      t.record({ stake: 8_000, payout: 7_600, bettors: 10 });
    }
    expect(t.exposureFactor()).toBeGreaterThan(0);
    expect(t.exposureFactor()).toBeLessThanOrEqual(1);
  });

  it('exposureFactor is negative when stake is much lower than reference', () => {
    const t = makeTracker();
    for (let i = 0; i < 10; i++) {
      t.record({ stake: 50, payout: 48, bettors: 1 });
    }
    expect(t.exposureFactor()).toBeLessThan(0);
    expect(t.exposureFactor()).toBeGreaterThanOrEqual(-1);
  });

  it('exposureFactor ≈ 0 when stake equals reference', () => {
    const t = makeTracker();
    for (let i = 0; i < 10; i++) {
      t.record({ stake: 1_000, payout: 950, bettors: 3 });
    }
    expect(Math.abs(t.exposureFactor())).toBeLessThan(0.05);
  });

  it('rtpDriftFactor stays 0 for the first 50 rounds (insufficient signal)', () => {
    const t = makeTracker();
    for (let i = 0; i < 30; i++) {
      t.record({ stake: 1_000, payout: 950, bettors: 1 });
    }
    expect(t.rtpDriftFactor(0.96)).toBe(0);
  });

  it('rtpDriftFactor nudges positive when realised RTP overshoots target', () => {
    const t = makeTracker();
    for (let i = 0; i < 100; i++) {
      t.record({ stake: 1_000, payout: 990, bettors: 3 });
    }
    expect(t.rtpDriftFactor(0.96)).toBeGreaterThan(0);
    expect(t.rtpDriftFactor(0.96)).toBeLessThanOrEqual(0.1);
  });

  it('rtpDriftFactor nudges negative when realised RTP undershoots target', () => {
    const t = makeTracker();
    for (let i = 0; i < 100; i++) {
      t.record({ stake: 1_000, payout: 900, bettors: 3 });
    }
    expect(t.rtpDriftFactor(0.96)).toBeLessThan(0);
    expect(t.rtpDriftFactor(0.96)).toBeGreaterThanOrEqual(-0.1);
  });

  it('reset wipes the EMAs', () => {
    const t = makeTracker();
    t.record({ stake: 1_000, payout: 950, bettors: 3 });
    t.reset();
    expect(t.snapshot().roundsObserved).toBe(0);
    expect(t.snapshot().smoothedStake).toBe(0);
    expect(t.exposureFactor()).toBe(0);
  });

  it('does not jump abruptly with a single bursty round (smoothing)', () => {
    const t = makeTracker();
    for (let i = 0; i < 50; i++) {
      t.record({ stake: 1_000, payout: 950, bettors: 3 });
    }
    const before = t.exposureFactor();
    t.record({ stake: 100_000, payout: 95_000, bettors: 30 });
    const after = t.exposureFactor();
    expect(after).toBeGreaterThan(before);
    expect(after - before).toBeLessThan(0.5);
  });
});
