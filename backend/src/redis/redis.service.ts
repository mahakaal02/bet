import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;
  /**
   * Process-local fallback mutex used when Redis is unreachable. Without
   * Redis we can't coordinate across nodes, but a single-process dev box
   * still needs serialised access to the same critical section (e.g. the
   * auction scheduler) — otherwise two concurrent `EVERY_MINUTE` ticks
   * could double-promote or double-close.
   *
   * `Map<key, Promise>` — each key's promise resolves when the in-flight
   * holder finishes. We chain on the existing promise to serialise.
   */
  private readonly localLocks = new Map<string, Promise<unknown>>();
  /**
   * Flipped to false the first time a Redis op throws. Subsequent calls
   * skip Redis entirely (in-process fallback) until the process restarts.
   * Avoids per-tick `ECONNREFUSED` spam in dev.
   */
  private redisAvailable = true;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    this.client = new Redis(
      this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
      {
        // Don't hammer a missing Redis with reconnect storms in dev. Two
        // failures and we fall back to in-process; a process restart
        // re-tests connectivity.
        maxRetriesPerRequest: 2,
        // Suppress the per-attempt error-event spam — we log the first
        // failure ourselves in `withLock`.
        lazyConnect: false,
        retryStrategy: () => null,
      },
    );
    // Soak up the ECONNREFUSED stream the client emits when Redis is
    // missing — we report it once, then go quiet.
    this.client.on('error', () => {
      if (this.redisAvailable) {
        this.logger.warn(
          'Redis unreachable — falling back to in-process locks (dev mode). ' +
            'Production deployments MUST have REDIS_URL pointing at a running Redis.',
        );
        this.redisAvailable = false;
      }
    });
  }

  async onModuleDestroy() {
    await this.client?.quit().catch(() => {});
  }

  get io(): Redis {
    return this.client;
  }

  /**
   * Short-lived advisory lock with a graceful in-process fallback.
   *
   *   - If Redis is reachable: uses `SET key NX PX ttlMs`, runs `fn`, releases
   *     via Lua compare-and-delete. Returns `null` if another node already
   *     holds the lock.
   *   - If Redis is unreachable (or has been flagged unavailable): serialises
   *     by chaining on `localLocks.get(key)` — works for a single-process
   *     dev box. Multi-instance prod MUST have Redis up.
   */
  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
    if (this.redisAvailable) {
      try {
        const token = `${Date.now()}-${Math.random()}`;
        const acquired = await this.client.set(`lock:${key}`, token, 'PX', ttlMs, 'NX');
        if (acquired !== 'OK') return null;
        try {
          return await fn();
        } finally {
          const lua = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
          await this.client.eval(lua, 1, `lock:${key}`, token).catch(() => {});
        }
      } catch (err) {
        // First failure flips the flag; subsequent calls skip Redis.
        if (this.redisAvailable) {
          this.logger.warn(
            `Redis lock(${key}) failed: ${(err as Error).message} — falling back to in-process lock`,
          );
          this.redisAvailable = false;
        }
        // Fall through to the in-process path.
      }
    }
    return this.localWithLock(key, fn);
  }

  /**
   * Serialise on a per-key in-memory promise chain. Two concurrent
   * `withLock("k", …)` calls will run their `fn` back-to-back, not in
   * parallel.
   *
   * The map entry is the SILENCED next promise (`.catch(() => {})`) so a
   * thrown `fn` doesn't poison subsequent waiters — they should still run
   * even if a prior holder failed. Callers see the original error via
   * `await next`.
   */
  private async localWithLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.localLocks.get(key) ?? Promise.resolve();
    const next = prior.then(fn, fn);
    const silenced = next.catch(() => {});
    this.localLocks.set(key, silenced);
    return next;
  }
}
