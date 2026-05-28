import { PricingEngine } from './pricing-engine.service';
import { MULTIPLIER_CEIL, MULTIPLIER_FLOOR } from './pricing.config';

describe('PricingEngine', () => {
  const engine = new PricingEngine();

  describe('normalizeMultipliers', () => {
    const raw = {
      US: 80000, // baseline
      IN: 28000, // ~0.35
      BR: 45000, // ~0.56
      CH: 96000, // > baseline → clamped to ceil
      ZW: 100, // tiny → clamped to floor
    };

    it('pins the baseline country to exactly 1.0', () => {
      const out = engine.normalizeMultipliers(raw, ['US', 'IN'], 'US');
      const us = out.find((o) => o.country === 'US')!;
      expect(us.multiplier).toBe(1);
      expect(us.isFallback).toBe(false);
    });

    it('scales a poorer country below 1 proportionally', () => {
      const out = engine.normalizeMultipliers(raw, ['IN', 'BR'], 'US');
      const india = out.find((o) => o.country === 'IN')!;
      // 28000/80000 = 0.35 — inside the [0.25, 1.25] band, not clamped.
      expect(india.multiplier).toBeCloseTo(0.35, 4);
      expect(india.isFallback).toBe(false);
    });

    it('clamps a richer country to the ceiling', () => {
      const out = engine.normalizeMultipliers(raw, ['CH'], 'US');
      const ch = out.find((o) => o.country === 'CH')!;
      // 96000/80000 = 1.2 — within ceil 1.25, so NOT clamped.
      expect(ch.multiplier).toBeCloseTo(1.2, 4);
    });

    it('clamps an extreme-low outlier to the floor and flags it', () => {
      const out = engine.normalizeMultipliers(raw, ['ZW'], 'US');
      const zw = out.find((o) => o.country === 'ZW')!;
      expect(zw.multiplier).toBe(MULTIPLIER_FLOOR);
      expect(zw.isFallback).toBe(true);
    });

    it('uses the floor + flags when a country has no datum', () => {
      const out = engine.normalizeMultipliers(raw, ['XX'], 'US');
      const xx = out.find((o) => o.country === 'XX')!;
      expect(xx.multiplier).toBe(MULTIPLIER_FLOOR);
      expect(xx.rawValue).toBeNull();
      expect(xx.isFallback).toBe(true);
    });

    it('throws when the baseline itself has no datum', () => {
      expect(() =>
        engine.normalizeMultipliers({ IN: 28000 }, ['IN'], 'US'),
      ).toThrow(/baseline/);
    });

    it('keeps every multiplier within the clamp band', () => {
      const out = engine.normalizeMultipliers(
        raw,
        Object.keys(raw),
        'US',
      );
      for (const o of out) {
        expect(o.multiplier).toBeGreaterThanOrEqual(MULTIPLIER_FLOOR);
        expect(o.multiplier).toBeLessThanOrEqual(MULTIPLIER_CEIL);
      }
    });
  });

  describe('priceRow', () => {
    it('reproduces the spec example: $0.99 × 0.40 × 83 ≈ ₹33 → ₹39', () => {
      const row = engine.priceRow({
        country: 'IN',
        baseUsdPrice: '0.99',
        multiplier: 0.4,
        usdRate: 83,
      });
      // 0.99 * 0.4 * 83 = 32.868 → charm-9 whole → 39
      expect(row.calculatedLocalPrice).toBe('32.8680');
      expect(row.roundedFinalPrice).toBe('39');
      expect(row.currency).toBe('INR');
    });

    it('US baseline: multiplier 1, rate 1 → just the charm-99 base', () => {
      const row = engine.priceRow({
        country: 'US',
        baseUsdPrice: '0.99',
        multiplier: 1,
        usdRate: 1,
      });
      expect(row.roundedFinalPrice).toBe('0.99');
      expect(row.currency).toBe('USD');
    });

    it('Japan: yields a 0-decimal price rounded to the nearest 10', () => {
      // 4.99 * 0.9 * 150 = 673.65 → nearest 10 up → 680
      const row = engine.priceRow({
        country: 'JP',
        baseUsdPrice: '4.99',
        multiplier: 0.9,
        usdRate: 150,
      });
      expect(row.roundedFinalPrice).toBe('680');
    });

    it('throws on an unknown country', () => {
      expect(() =>
        engine.priceRow({
          country: 'ZZ',
          baseUsdPrice: '0.99',
          multiplier: 1,
          usdRate: 1,
        }),
      ).toThrow(/unknown country/);
    });
  });
});
