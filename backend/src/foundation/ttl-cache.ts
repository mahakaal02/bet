/**
 * Tiny per-process TTL cache used by the foundation services.
 *
 * Why not Redis? The Redis upgrade (with PUBSUB invalidation +
 * BullMQ) is a separate infra PR — see `docs/PRODUCTION_ROADMAP.md`
 * §5.1. Until that lands, an in-process Map with a per-entry
 * expiry gives the same SLA as a Redis cache *without* cross-pod
 * invalidation: a flag flipped on pod A is invisible to pod B
 * until pod B's local entry expires.
 *
 * That's the same staleness window the original "Redis with TTL,
 * no PUBSUB" design carries, so swapping to Redis later is a
 * pure infra swap — no semantic change. The roadmap explicitly
 * accepts <TTL staleness for non-financial gating.
 *
 * Eviction: lazy (on read). A periodic sweep would be over-
 * engineering at the scale we're at — the cache key space is
 * O(catalog size), not O(users).
 */
export class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  invalidateAll(): void {
    this.store.clear();
  }

  /** Inspector — used by `/admin/health/cache` style endpoints. */
  size(): number {
    return this.store.size;
  }
}
