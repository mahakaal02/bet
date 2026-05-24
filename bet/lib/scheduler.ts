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
import { cancelOpenOrdersForMarket } from "@/lib/order-refund";

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
    //
    // Per-market transaction (not a bulk updateMany) so we can atomically
    // cancel any still-open orders on that market and refund the BUY-side
    // coin locks / release SELL-side share locks. Without this, a limit
    // order placed before `endsAt` would leave the user's coins debited
    // from their wallet forever — see `cancelOpenOrdersForMarket`.
    const expiring = await db.market.findMany({
      where: { status: "OPEN", endsAt: { lte: now } },
      select: { id: true },
      take: 100,
    });
    for (const { id } of expiring) {
      const result = await db.$transaction(async (tx) => {
        // Re-read inside the tx in case another tick raced us to the close.
        const m = await tx.market.findUnique({
          where: { id },
          select: { status: true },
        });
        if (!m || m.status !== "OPEN") return null;
        const refunds = await cancelOpenOrdersForMarket(tx, id);
        await tx.market.update({ where: { id }, data: { status: "CLOSED" } });
        return refunds;
      });
      if (result) {
        console.log(
          `[scheduler] closed market ${id} — cancelled ${result.cancelledCount} order(s), refunded ${result.refundedCoins} coins, released ${result.releasedShares.toFixed(2)} shares`,
        );
        publish(Channels.market(id), { type: "closed", at: Date.now() });
        if (result.cancelledCount > 0) {
          publish(Channels.market(id), { type: "book", at: Date.now() });
          // type: "wallet" tells the user's SSE client to refetch their
          // balance — same event the topup/verify routes use. Matches the
          // existing client subscription surface so we don't need to teach
          // it about a new event kind.
          for (const userId of result.affectedUserIds) {
            publish(Channels.user(userId), {
              type: "wallet",
              at: Date.now(),
            });
          }
        }
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
