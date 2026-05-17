import {
  computeCrashMultiplier,
  deriveClientSeed,
  generateServerSeed,
  hashServerSeed,
  multiplierAt,
  timeForMultiplier,
} from './fairness';

describe('generateServerSeed', () => {
  it('produces a 64-char hex string', () => {
    const seed = generateServerSeed();
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces unique values', () => {
    const a = generateServerSeed();
    const b = generateServerSeed();
    expect(a).not.toBe(b);
  });
});

describe('hashServerSeed', () => {
  it('matches a known SHA-256 vector', () => {
    expect(hashServerSeed('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('deriveClientSeed', () => {
  it('is deterministic', () => {
    const a = deriveClientSeed('aa'.repeat(32), 42);
    const b = deriveClientSeed('aa'.repeat(32), 42);
    expect(a).toBe(b);
  });

  it('changes when the previous seed changes', () => {
    const a = deriveClientSeed('aa'.repeat(32), 42);
    const b = deriveClientSeed('bb'.repeat(32), 42);
    expect(a).not.toBe(b);
  });

  it('handles genesis (no previous seed)', () => {
    expect(deriveClientSeed(null, 0)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('computeCrashMultiplier', () => {
  it('is deterministic for fixed inputs', () => {
    const a = computeCrashMultiplier('seed-a', 'client', 1);
    const b = computeCrashMultiplier('seed-a', 'client', 1);
    expect(a).toBe(b);
  });

  it('returns ≥ 1.00 for any input', () => {
    for (let n = 0; n < 100; n++) {
      const m = computeCrashMultiplier('seed', 'client', n);
      expect(m).toBeGreaterThanOrEqual(1.0);
    }
  });

  it('produces some 1.00 (insta-crash) results — house edge present', () => {
    let instaCount = 0;
    for (let n = 0; n < 10_000; n++) {
      if (computeCrashMultiplier('seed-distribution', 'client', n) === 1.0) {
        instaCount++;
      }
    }
    // 1-in-33 expected → roughly 300 over 10k. Allow generous bounds.
    expect(instaCount).toBeGreaterThan(150);
    expect(instaCount).toBeLessThan(500);
  });

  it('changes when the nonce changes', () => {
    const a = computeCrashMultiplier('seed', 'client', 1);
    const b = computeCrashMultiplier('seed', 'client', 2);
    // Tiny chance of collision; if this flakes, change the seed.
    expect(a).not.toBe(b);
  });
});

describe('multiplierAt', () => {
  it('returns 1.0 at t=0', () => {
    expect(multiplierAt(0)).toBe(1.0);
  });

  it('rises monotonically', () => {
    expect(multiplierAt(100)).toBeLessThan(multiplierAt(1_000));
    expect(multiplierAt(1_000)).toBeLessThan(multiplierAt(10_000));
  });

  it('matches expected check-points (approx)', () => {
    expect(multiplierAt(1_000)).toBeCloseTo(1.27, 1);
    expect(multiplierAt(5_000)).toBeCloseTo(3.30, 0);
    expect(multiplierAt(10_000)).toBeCloseTo(10.89, 0);
  });

  it('is the inverse of timeForMultiplier', () => {
    const m = 5.0;
    const t = timeForMultiplier(m);
    expect(multiplierAt(t)).toBeCloseTo(m, 2);
  });
});
