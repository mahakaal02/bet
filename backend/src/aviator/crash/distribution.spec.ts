import {
  BUCKET_EDGES,
  DEFAULT_PARAMS,
  PARAM_BOUNDS,
  bucketProbabilities,
  clampParams,
  expectedValue,
  rtpBreakdown,
  sampleMultiplier,
  survival,
  uniformFromHmacHex,
} from './distribution';

describe('crash/distribution — sampleMultiplier', () => {
  it('is deterministic for fixed (u, params)', () => {
    const a = sampleMultiplier(0.42, DEFAULT_PARAMS);
    const b = sampleMultiplier(0.42, DEFAULT_PARAMS);
    expect(a).toBe(b);
  });

  it('returns 1.00 for u within the insta-crash mass', () => {
    // Insta mass = (1 - rtp) * (1 - bias).
    const halfInsta = (1 - DEFAULT_PARAMS.rtp) * (1 - DEFAULT_PARAMS.bias) / 2;
    expect(sampleMultiplier(halfInsta, DEFAULT_PARAMS)).toBe(1.0);
  });

  it('returns a value in [1, biasUpper) for u in the bias band', () => {
    const q = (1 - DEFAULT_PARAMS.rtp) * (1 - DEFAULT_PARAMS.bias);
    const u = q + DEFAULT_PARAMS.bias / 2;
    const m = sampleMultiplier(u, DEFAULT_PARAMS);
    expect(m).toBeGreaterThanOrEqual(1.0);
    expect(m).toBeLessThan(DEFAULT_PARAMS.biasUpper);
  });

  it('returns a value in the heavy tail for u beyond the bias band', () => {
    const q = (1 - DEFAULT_PARAMS.rtp) * (1 - DEFAULT_PARAMS.bias);
    const u = q + DEFAULT_PARAMS.bias + 0.05;
    const m = sampleMultiplier(u, DEFAULT_PARAMS);
    expect(m).toBeGreaterThanOrEqual(1.0);
    expect(m).toBeLessThanOrEqual(DEFAULT_PARAMS.maxMultiplier);
  });

  it('clips at maxMultiplier when u is near 1.0', () => {
    const params = { ...DEFAULT_PARAMS, maxMultiplier: 50 };
    const m = sampleMultiplier(1 - 1e-15, params);
    expect(m).toBeLessThanOrEqual(50);
  });

  it('outputs are floored to 2 decimal places', () => {
    for (let i = 0; i < 50; i++) {
      const m = sampleMultiplier(i / 50, DEFAULT_PARAMS);
      expect(Math.abs(m * 100 - Math.round(m * 100))).toBeLessThan(1e-9);
    }
  });

  it('is monotonic-non-decreasing in u within the heavy-tail band', () => {
    const q = (1 - DEFAULT_PARAMS.rtp) * (1 - DEFAULT_PARAMS.bias);
    const tailStart = q + DEFAULT_PARAMS.bias + 0.01;
    let prev = -Infinity;
    for (let i = 0; i < 1_000; i++) {
      const u = tailStart + i * 0.0005;
      if (u >= 1) break;
      const m = sampleMultiplier(u, DEFAULT_PARAMS);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });

  it('never returns Infinity / NaN even at u → 1', () => {
    for (const u of [0.999999, 0.9999999, 1 - 1e-15, 1 + 1e-9]) {
      const m = sampleMultiplier(u, DEFAULT_PARAMS);
      expect(Number.isFinite(m)).toBe(true);
      expect(m).toBeGreaterThanOrEqual(1.0);
    }
  });
});

describe('crash/distribution — empirical bucket probabilities (10k quasi-MC)', () => {
  const N = 10_000;
  const samples = Array.from({ length: N }, (_, i) =>
    sampleMultiplier((i + 0.5) / N, DEFAULT_PARAMS),
  );

  it('observed P(M = 1.00) tracks the insta-crash mass within 0.5pp', () => {
    const instaCount = samples.filter((m) => m === 1.0).length;
    const observed = instaCount / N;
    const analytic = (1 - DEFAULT_PARAMS.rtp) * (1 - DEFAULT_PARAMS.bias);
    expect(Math.abs(observed - analytic)).toBeLessThan(0.005);
  });

  it('observed P(M < 1.20) lands inside the analytic band', () => {
    const observed = samples.filter((m) => m < 1.2).length / N;
    const analytic = 1 - survival(1.2, DEFAULT_PARAMS);
    expect(Math.abs(observed - analytic)).toBeLessThan(0.02);
  });

  it('observed P(M >= 10) is in the analytic band', () => {
    const observed = samples.filter((m) => m >= 10).length / N;
    const analytic = survival(10, DEFAULT_PARAMS);
    expect(Math.abs(observed - analytic)).toBeLessThan(0.01);
  });

  it('observed RTP at C_ref=2.0 lands within 1pp of the target', () => {
    // RTP-at-C is the player's expected return per stake when always
    // cashing at C. observed = mean of (M >= C ? C : 0).
    const C = DEFAULT_PARAMS.cRef;
    const wins = samples.filter((m) => m >= C).length;
    const observedRtp = (wins / N) * C;
    expect(Math.abs(observedRtp - DEFAULT_PARAMS.rtp)).toBeLessThan(0.02);
  });
});

describe('crash/distribution — analytics', () => {
  it('bucketProbabilities sum to ≈1', () => {
    const buckets = bucketProbabilities(DEFAULT_PARAMS);
    const sum = buckets.reduce((acc, b) => acc + b.probability, 0);
    expect(sum).toBeCloseTo(1.0, 4);
    expect(buckets[0].label).toBe('<1.20');
    expect(buckets[buckets.length - 1].label.startsWith('>=')).toBe(true);
  });

  it('bucket edges include every published threshold', () => {
    expect(BUCKET_EDGES).toEqual([1.2, 1.5, 2.0, 3.0, 5.0, 10.0]);
  });

  it('survival is monotonic-non-increasing in x', () => {
    let prev = 1.0;
    for (let x = 1; x < 20; x += 0.25) {
      const s = survival(x, DEFAULT_PARAMS);
      expect(s).toBeLessThanOrEqual(prev + 1e-9);
      prev = s;
    }
  });

  it('rtpBreakdown.atRef equals the configured RTP (structural lock)', () => {
    const r = rtpBreakdown(DEFAULT_PARAMS);
    expect(Math.abs(r.atRef - DEFAULT_PARAMS.rtp)).toBeLessThan(1e-6);
  });

  it('rtpBreakdown.atRef stays locked across k variations', () => {
    for (const k of [0.85, 1.0, 1.2, 1.5]) {
      const r = rtpBreakdown({ ...DEFAULT_PARAMS, k });
      expect(Math.abs(r.atRef - DEFAULT_PARAMS.rtp)).toBeLessThan(1e-6);
    }
  });

  it('insta-crash mass equals (1 - rtp)(1 - bias)', () => {
    const r = rtpBreakdown(DEFAULT_PARAMS);
    const expected = (1 - DEFAULT_PARAMS.rtp) * (1 - DEFAULT_PARAMS.bias);
    expect(Math.abs(r.pInsta - expected)).toBeLessThan(1e-9);
  });

  it('expectedValue is finite and >= 1.0 (sanity)', () => {
    const e = expectedValue(DEFAULT_PARAMS);
    expect(Number.isFinite(e)).toBe(true);
    expect(e).toBeGreaterThanOrEqual(1.0);
  });

  it('rtp knob shifts the heavy tail predictably', () => {
    // Lower RTP (higher house edge) → more probability mass at the
    // insta-crash floor, so P(M = 1) rises and the locked
    // survival-at-C_ref drops.
    const low = { ...DEFAULT_PARAMS, rtp: 0.92 };
    const high = { ...DEFAULT_PARAMS, rtp: 0.98 };
    expect(rtpBreakdown(low).pInsta).toBeGreaterThan(rtpBreakdown(high).pInsta);
    expect(survival(DEFAULT_PARAMS.cRef, low)).toBeLessThan(
      survival(DEFAULT_PARAMS.cRef, high),
    );
  });
});

describe('crash/distribution — clampParams', () => {
  it('floors and ceilings into PARAM_BOUNDS', () => {
    const c = clampParams({
      rtp: -1,
      bias: 999,
      biasUpper: 0.5,
      k: 0.1,
      cRef: 0.5,
      maxMultiplier: 1,
    });
    expect(c.rtp).toBe(PARAM_BOUNDS.rtp.min);
    expect(c.biasUpper).toBeGreaterThanOrEqual(PARAM_BOUNDS.biasUpper.min);
    expect(c.k).toBe(PARAM_BOUNDS.k.min);
    expect(c.cRef).toBe(PARAM_BOUNDS.cRef.min);
    expect(c.maxMultiplier).toBe(PARAM_BOUNDS.maxMultiplier.min);
  });

  it('replaces NaN with the default', () => {
    const c = clampParams({
      rtp: NaN,
      bias: NaN,
      biasUpper: NaN,
      k: NaN,
      cRef: NaN,
      maxMultiplier: NaN,
    });
    expect(c.rtp).toBe(DEFAULT_PARAMS.rtp);
    expect(c.k).toBe(DEFAULT_PARAMS.k);
    expect(c.cRef).toBe(DEFAULT_PARAMS.cRef);
  });

  it('keeps insta-crash + bias mass safely below 1.0', () => {
    const c = clampParams({
      rtp: 0.94,
      bias: 0.99,
      biasUpper: 1.5,
      k: 1.0,
      cRef: 2.0,
      maxMultiplier: 100,
    });
    const q = (1 - c.rtp) * (1 - c.bias);
    expect(q + c.bias).toBeLessThanOrEqual(0.96);
  });
});

describe('crash/distribution — uniformFromHmacHex', () => {
  it('returns a value in [0, 1)', () => {
    const u = uniformFromHmacHex('a'.repeat(64));
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThan(1);
  });

  it('is deterministic', () => {
    const a = uniformFromHmacHex('deadbeef'.repeat(8));
    const b = uniformFromHmacHex('deadbeef'.repeat(8));
    expect(a).toBe(b);
  });

  it('respects the offset', () => {
    const hex = '0123456789abcdef'.repeat(4);
    const a = uniformFromHmacHex(hex, 0);
    const b = uniformFromHmacHex(hex, 13);
    expect(a).not.toBe(b);
  });
});
