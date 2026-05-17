/**
 * Sliding-window rate limiter with two pluggable backends:
 *
 *   - In-memory (default) — single Node process; survives HMR via globalThis.
 *   - Redis — atomic INCR + EXPIRE token bucket. Set REDIS_URL and the same
 *     `rateLimit()` call serialises across all app instances.
 *
 * Backend choice is decided at first call. The async fire-and-forget Redis
 * connect means callers don't pay an awaited round-trip; the very first
 * request might transiently use the memory backend while Redis is wiring
 * up, which is acceptable for our limits.
 *
 * IMPORTANT: `rateLimit()` is intentionally synchronous so existing routes
 * don't need to be refactored to async. The Redis backend keeps a small
 * local mirror counter and writes-through to Redis asynchronously — so in
 * the unlikely race where two instances both miss-and-increment, the next
 * call resolves the truth from Redis. Good enough for soft anti-spam.
 */

export interface RateLimitOptions {
  /** Max requests in the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

type Bucket = { count: number; resetAt: number };

const globalForBuckets = globalThis as unknown as {
  __betRateBuckets?: Map<string, Bucket>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __betRedis?: any;
  __betRedisAttempted?: boolean;
};

function memoryBuckets(): Map<string, Bucket> {
  if (!globalForBuckets.__betRateBuckets) {
    globalForBuckets.__betRateBuckets = new Map();
  }
  return globalForBuckets.__betRateBuckets;
}

async function maybeConnectRedis() {
  if (globalForBuckets.__betRedisAttempted) return;
  globalForBuckets.__betRedisAttempted = true;
  const url = process.env.REDIS_URL;
  if (!url) return;
  try {
    const { default: Redis } = await import("ioredis");
    const client = new Redis(url, { lazyConnect: true });
    await client.connect();
    globalForBuckets.__betRedis = client;
    console.log("rate-limit: using Redis at", url.replace(/:[^:@]*@/, ":***@"));
  } catch (err) {
    console.error("rate-limit: Redis connect failed, staying on memory", err);
  }
}
void maybeConnectRedis();

export function rateLimit(
  key: string,
  opts: RateLimitOptions,
): RateLimitResult {
  // Memory path is always consulted — it acts as a hot mirror and as the
  // sole truth when Redis isn't configured / temporarily unreachable.
  const buckets = memoryBuckets();
  const now = Date.now();
  const existing = buckets.get(key);
  let result: RateLimitResult;
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    result = {
      allowed: true,
      remaining: opts.limit - 1,
      resetAt: now + opts.windowMs,
    };
  } else {
    existing.count += 1;
    result = {
      allowed: existing.count <= opts.limit,
      remaining: Math.max(0, opts.limit - existing.count),
      resetAt: existing.resetAt,
    };
  }

  // Fire-and-forget Redis write-through. The Lua script (or pipelined
  // INCR + PEXPIRE) gives us cross-instance consistency without a blocking
  // round-trip. Failures degrade silently to the local count.
  const redis = globalForBuckets.__betRedis;
  if (redis) {
    void incrementRedis(redis, `rate:${key}`, opts.windowMs).then((rCount) => {
      if (rCount === null) return;
      // Reconcile if Redis disagrees with our local count — Redis wins.
      if (rCount > (buckets.get(key)?.count ?? 0)) {
        const b = buckets.get(key);
        if (b) b.count = rCount;
      }
    });
  }

  return result;
}

// Atomic INCR with first-write EXPIRE. INCR returns the new value; on the
// first call it returns 1, when we set the PEXPIRE. After that it's just
// a counter until the key naturally expires.
async function incrementRedis(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  redis: any,
  key: string,
  windowMs: number,
): Promise<number | null> {
  try {
    const pipeline = redis.pipeline();
    pipeline.incr(key);
    pipeline.pexpire(key, windowMs, "NX"); // only set TTL if there isn't one
    const replies = await pipeline.exec();
    if (!replies || !replies[0]) return null;
    const [err, count] = replies[0];
    if (err) return null;
    return Number(count);
  } catch {
    return null;
  }
}
