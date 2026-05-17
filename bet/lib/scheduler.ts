/**
 * Lightweight in-process scheduler. Closes markets whose `endsAt` has passed
 * (status OPEN → CLOSED) and decays each market's trending score so the
 * landing-page "Trending" widget naturally rolls newer activity to the top.
 *
 * Runs every 60s and survives Next.js HMR via `globalThis`. For production
 * multi-instance deployments, swap this for a Redis-leader cron or a
 * dedicated worker — running on every web instance would spam the DB. For
 * single-instance the in-process tick is simpler and good enough.
 */
import { db } from "@/lib/db";
import { publish, Channels } from "@/lib/pubsub";

const globalForScheduler = globalThis as unknown as {
  __betScheduler?: NodeJS.Timeout;
};

const INTERVAL_MS = 60_000;
// Half-life for trending decay. Per tick: score *= (1/2) ^ (60s / halfLife).
const TRENDING_HALF_LIFE_MS = 6 * 60 * 60 * 1000; // 6h

async function tick() {
  try {
    const now = new Date();

    // Close any OPEN markets whose endsAt has passed. Trading was already
    // refused by the trade route since endsAt < now, but the status flag is
    // what every list view filters on — flipping it here keeps the UI honest.
    const expired = await db.market.updateMany({
      where: { status: "OPEN", endsAt: { lte: now } },
      data: { status: "CLOSED" },
    });
    if (expired.count > 0) {
      console.log(`[scheduler] closed ${expired.count} expired market(s)`);
      // Each affected market gets a SSE ping so live viewers refresh state.
      const ids = await db.market.findMany({
        where: { status: "CLOSED", endsAt: { lte: now } },
        select: { id: true },
        take: 100,
      });
      for (const { id } of ids) {
        publish(Channels.market(id), { type: "closed", at: Date.now() });
      }
    }

    // Decay trending. The 60s tick with a 6h half-life multiplies the score
    // by ≈0.998 each pass — a single trade dominates the score for ~30 min
    // before recent fresh activity overtakes it.
    const decay = Math.pow(0.5, INTERVAL_MS / TRENDING_HALF_LIFE_MS);
    await db.$executeRaw`UPDATE "Market" SET "trendingScore" = "trendingScore" * ${decay} WHERE "trendingScore" > 0.01`;
  } catch (err) {
    console.error("[scheduler] tick failed", err);
  }
}

export function startScheduler() {
  if (globalForScheduler.__betScheduler) return;
  // Kick once on boot so a dev server that's been restarting won't hold a
  // bunch of "expired but still OPEN" markets.
  void tick();
  globalForScheduler.__betScheduler = setInterval(() => {
    void tick();
  }, INTERVAL_MS);
  console.log(`[scheduler] started, tick every ${INTERVAL_MS / 1000}s`);
}
