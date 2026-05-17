/**
 * Pub/sub for live updates. Two backends:
 *
 *   - In-memory `EventEmitter` (default) — fine on a single Node process.
 *     Survives HMR via globalThis caching, same trick Prisma uses.
 *   - Redis pub/sub when `REDIS_URL` is set — needed once the app runs on
 *     multiple instances behind a load balancer.
 *
 * The public surface is intentionally tiny:
 *
 *   publish(channel, data)
 *   subscribe(channel, handler) → unsubscribe()
 *
 * Channel naming convention: "market:<marketId>" for price ticks,
 * "user:<userId>" for personal notifications.
 */
import { EventEmitter } from "events";

type Handler = (data: unknown) => void;

interface PubSub {
  publish: (channel: string, data: unknown) => void;
  subscribe: (channel: string, handler: Handler) => () => void;
}

function makeMemoryPubsub(): PubSub {
  const bus = new EventEmitter();
  // SSE streams hold one listener per active client; the default 10-listener
  // warning fires immediately. Setting to 0 disables the cap.
  bus.setMaxListeners(0);
  return {
    publish: (channel, data) => {
      bus.emit(channel, data);
    },
    subscribe: (channel, handler) => {
      bus.on(channel, handler);
      return () => bus.off(channel, handler);
    },
  };
}

/**
 * Redis backend. Imported lazily so the package only resolves when the env
 * var is set — keeps the in-mem fallback dependency-free for local dev.
 */
async function makeRedisPubsub(url: string): Promise<PubSub> {
  const { default: Redis } = await import("ioredis");
  const pub = new Redis(url, { lazyConnect: true });
  const sub = new Redis(url, { lazyConnect: true });
  await Promise.all([pub.connect(), sub.connect()]);
  const handlers = new Map<string, Set<Handler>>();

  sub.on("message", (channel, message) => {
    const set = handlers.get(channel);
    if (!set) return;
    let data: unknown;
    try {
      data = JSON.parse(message);
    } catch {
      data = message;
    }
    for (const h of set) {
      try {
        h(data);
      } catch (err) {
        console.error("subscriber threw", err);
      }
    }
  });

  return {
    publish: (channel, data) => {
      void pub.publish(channel, JSON.stringify(data));
    },
    subscribe: (channel, handler) => {
      let set = handlers.get(channel);
      if (!set) {
        set = new Set();
        handlers.set(channel, set);
        void sub.subscribe(channel);
      }
      set.add(handler);
      return () => {
        set!.delete(handler);
        if (set!.size === 0) {
          handlers.delete(channel);
          void sub.unsubscribe(channel);
        }
      };
    },
  };
}

// HMR / dev: keep the singleton across reloads so SSE streams started before
// a hot-reload keep getting events.
const globalForPubsub = globalThis as unknown as { __betPubsub?: PubSub };

function memorySingleton(): PubSub {
  if (!globalForPubsub.__betPubsub) {
    globalForPubsub.__betPubsub = makeMemoryPubsub();
  }
  return globalForPubsub.__betPubsub;
}

let backend: PubSub = memorySingleton();
let upgradeAttempted = false;

async function maybeUpgradeToRedis() {
  if (upgradeAttempted) return;
  upgradeAttempted = true;
  const url = process.env.REDIS_URL;
  if (!url) return;
  try {
    backend = await makeRedisPubsub(url);
    console.log("pubsub: using Redis at", url.replace(/:[^:@]*@/, ":***@"));
  } catch (err) {
    console.error("pubsub: Redis connect failed, staying on memory", err);
  }
}
void maybeUpgradeToRedis();

export function publish(channel: string, data: unknown): void {
  backend.publish(channel, data);
}

export function subscribe(channel: string, handler: Handler): () => void {
  return backend.subscribe(channel, handler);
}

/** Channel-key helpers, so the strings live in one place. */
export const Channels = {
  market: (id: string) => `market:${id}`,
  user: (id: string) => `user:${id}`,
  /** Global activity feed — every trade across every market lands here. */
  global: () => `global`,
};
