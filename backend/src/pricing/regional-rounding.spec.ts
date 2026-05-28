import { roundPriceForRegion } from './regional-rounding';

/**
 * Psychological-rounding tests. These pin the exact examples from the
 * spec so a future refactor of the rounding ladders can't silently
 * change a published price point.
 */
describe('roundPriceForRegion', () => {
  it('India: rounds up to a whole number ending in 9', () => {
    expect(roundPriceForRegion('IN', 33.07).toString()).toBe('39');
    expect(roundPriceForRegion('IN', 41).toString()).toBe('49');
    expect(roundPriceForRegion('IN', 142).toString()).toBe('149');
    // Already a charm point stays put.
    expect(roundPriceForRegion('IN', 39).toString()).toBe('39');
  });

  it('USA: rounds up to x.99', () => {
    expect(roundPriceForRegion('US', 0.91).toString()).toBe('0.99');
    expect(roundPriceForRegion('US', 0.99).toString()).toBe('0.99');
    expect(roundPriceForRegion('US', 4.3).toString()).toBe('4.99');
    expect(roundPriceForRegion('US', 5.0).toString()).toBe('5.99');
  });

  it('Brazil: rounds up to x.99', () => {
    expect(roundPriceForRegion('BR', 17.2).toString()).toBe('17.99');
    expect(roundPriceForRegion('BR', 4.99).toString()).toBe('4.99');
  });

  it('Japan: rounds up to the nearest 10, no decimals', () => {
    expect(roundPriceForRegion('JP', 143).toString()).toBe('150');
    expect(roundPriceForRegion('JP', 150).toString()).toBe('150');
    expect(roundPriceForRegion('JP', 151).toString()).toBe('160');
  });

  it('Indonesia: rounds up to the nearest 500, no decimals', () => {
    expect(roundPriceForRegion('ID', 14250).toString()).toBe('14500');
    expect(roundPriceForRegion('ID', 15001).toString()).toBe('15500');
  });

  it('never rounds DOWN below the input', () => {
    for (const [country, value] of [
      ['IN', 38.9],
      ['US', 0.92],
      ['BR', 17.01],
      ['JP', 141],
    ] as const) {
      expect(
        Number(roundPriceForRegion(country, value)),
      ).toBeGreaterThanOrEqual(value);
    }
  });

  it('returns 0 for non-positive input', () => {
    expect(roundPriceForRegion('IN', 0).toString()).toBe('0');
    expect(roundPriceForRegion('US', -5).toString()).toBe('0');
  });

  it('handles unknown country with a safe 2dp ceil', () => {
    // Antarctica — not in the catalog. Must not throw.
    expect(roundPriceForRegion('AQ', 3.211).toString()).toBe('3.22');
  });
});
