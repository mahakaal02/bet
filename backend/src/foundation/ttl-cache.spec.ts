import { TtlCache } from './ttl-cache';

/**
 * Pure-data cache — tested without any clock mocking by passing a
 * very small TTL and using setTimeout in the expiry test. The
 * cache uses `Date.now()` internally so we can't inject a fake
 * clock without changing the API, but the behaviour is simple
 * enough that 20 ms of real-time wait is fine.
 */
describe('TtlCache', () => {
  it('returns undefined for an unknown key', () => {
    const cache = new TtlCache<number>(1000);
    expect(cache.get('nope')).toBeUndefined();
  });

  it('returns the value within TTL', () => {
    const cache = new TtlCache<number>(1000);
    cache.set('a', 42);
    expect(cache.get('a')).toBe(42);
  });

  it('caches the null sentinel without colliding with "missing"', () => {
    // The flag service uses `null` to mean "row genuinely doesn't
    // exist" and wants that outcome cached too. `get()` must
    // return the stored null, not undefined.
    const cache = new TtlCache<number | null>(1000);
    cache.set('a', null);
    expect(cache.get('a')).toBeNull();
  });

  it('expires the value after TTL elapses', async () => {
    const cache = new TtlCache<number>(20);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    await new Promise((r) => setTimeout(r, 30));
    expect(cache.get('a')).toBeUndefined();
  });

  it('invalidate() removes a single key', () => {
    const cache = new TtlCache<number>(1000);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.invalidate('a');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
  });

  it('invalidateAll() clears everything', () => {
    const cache = new TtlCache<number>(1000);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.invalidateAll();
    expect(cache.size()).toBe(0);
  });
});
