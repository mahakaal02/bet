/**
 * Achievement evaluation engine. Trigger-driven, not nightly-cron-driven —
 * we only re-check the achievements whose preconditions could have changed
 * for *this* user given *this* event. That keeps cost O(1) per write instead
 * of O(N achievements × N users) on a schedule.
 *
 *   on trade      → first_trade, ten_trades, hundred_trades, whale, diversified
 *   on resolution → first_win, profitable
 *   on daily clm  → streak_7
 *   on watch     → watch_5
 *   on referral  → referrer
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { publish, Channels } from "@/lib/pubsub";

type Tx = Prisma.TransactionClient | PrismaClient;

export interface UnlockResult {
  code: string;
  title: string;
  icon: string;
  rewardCoins: number;
  rewardXp: number;
}

/**
 * Award an achievement if not already unlocked. Idempotent — the unique
 * `(userId, achievementId)` index makes double-unlock a no-op.
 *
 * Returns the unlock when it was newly awarded, null if already had it or
 * the code doesn't exist. Caller decides whether to publish a notification.
 */
async function award(
  tx: Tx,
  userId: string,
  code: string,
): Promise<UnlockResult | null> {
  const ach = await tx.achievement.findUnique({ where: { code } });
  if (!ach) return null;

  const existing = await tx.userAchievement.findUnique({
    where: { userId_achievementId: { userId, achievementId: ach.id } },
  });
  if (existing) return null;

  await tx.userAchievement.create({
    data: { userId, achievementId: ach.id },
  });

  if (ach.rewardCoins > 0) {
    await tx.wallet.update({
      where: { userId },
      data: { balance: { increment: ach.rewardCoins } },
    });
    await tx.transaction.create({
      data: {
        userId,
        delta: ach.rewardCoins,
        kind: "achievement_reward",
        reference: `ach:${ach.code}:${userId}`,
        metadata: { achievementCode: ach.code },
      },
    });
  }
  if (ach.rewardXp > 0) {
    await tx.user.update({
      where: { id: userId },
      data: { xp: { increment: ach.rewardXp } },
    });
  }

  await tx.notification.create({
    data: {
      userId,
      title: `Achievement unlocked: ${ach.title}`,
      body: `${ach.icon} ${ach.description}${
        ach.rewardCoins > 0 ? ` · +${ach.rewardCoins} coins` : ""
      }`,
      href: "/profile",
    },
  });

  return {
    code: ach.code,
    title: ach.title,
    icon: ach.icon,
    rewardCoins: ach.rewardCoins,
    rewardXp: ach.rewardXp,
  };
}

/** Called from the trade route after the AMM update succeeds. */
export async function onTrade(
  tx: Tx,
  userId: string,
  ctx: { coinsSpent: number },
): Promise<UnlockResult[]> {
  const unlocks: UnlockResult[] = [];
  const tradeCount = await tx.trade.count({ where: { userId } });
  if (tradeCount === 1) {
    const u = await award(tx, userId, "first_trade");
    if (u) unlocks.push(u);
  }
  if (tradeCount === 10) {
    const u = await award(tx, userId, "ten_trades");
    if (u) unlocks.push(u);
  }
  if (tradeCount === 100) {
    const u = await award(tx, userId, "hundred_trades");
    if (u) unlocks.push(u);
  }
  if (ctx.coinsSpent >= 10_000) {
    const u = await award(tx, userId, "whale");
    if (u) unlocks.push(u);
  }
  // Diversified: 3 distinct categories among current positions.
  const categories = await tx.position.findMany({
    where: { userId, shares: { gt: 0 } },
    select: { market: { select: { category: true } } },
    distinct: ["marketId"],
  });
  const uniq = new Set(categories.map((p) => p.market.category));
  if (uniq.size >= 3) {
    const u = await award(tx, userId, "diversified");
    if (u) unlocks.push(u);
  }
  return unlocks;
}

/** Called from the admin resolve route AFTER payout has run for one position. */
export async function onResolution(
  tx: Tx,
  userId: string,
  ctx: { payout: number; costBasis: number },
): Promise<UnlockResult[]> {
  const unlocks: UnlockResult[] = [];
  if (ctx.payout > 0) {
    const u = await award(tx, userId, "first_win");
    if (u) unlocks.push(u);
  }
  // Profitable: realised net P/L across all positions ≥ 0.
  const agg = await tx.position.aggregate({
    where: { userId },
    _sum: { realizedPnl: true },
  });
  if ((agg._sum.realizedPnl ?? 0) > 0) {
    const u = await award(tx, userId, "profitable");
    if (u) unlocks.push(u);
  }
  return unlocks;
}

/** Called from the daily-claim route. */
export async function onDailyClaim(
  tx: Tx,
  userId: string,
  ctx: { streak: number },
): Promise<UnlockResult[]> {
  const unlocks: UnlockResult[] = [];
  if (ctx.streak >= 7) {
    const u = await award(tx, userId, "streak_7");
    if (u) unlocks.push(u);
  }
  return unlocks;
}

export async function onWatchlistAdd(userId: string): Promise<void> {
  const count = await db.watchlist.count({ where: { userId } });
  if (count >= 5) {
    await db.$transaction(async (tx) => {
      await award(tx, userId, "watch_5");
    });
  }
}

export async function onReferral(referrerId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await award(tx, referrerId, "referrer");
  });
}

/**
 * Helper to broadcast unlock notifications after the parent transaction
 * commits. Publishing inside `$transaction` would lose the message if the
 * tx rolls back.
 */
export function publishUnlocks(userId: string, unlocks: UnlockResult[]): void {
  for (const u of unlocks) {
    publish(Channels.user(userId), {
      type: "achievement_unlocked",
      ...u,
      at: Date.now(),
    });
  }
}
