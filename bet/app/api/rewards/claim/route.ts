import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { dailyReward } from "@/lib/coins";
import { onDailyClaim, publishUnlocks } from "@/lib/achievements";
import { publish, Channels } from "@/lib/pubsub";
import { logger } from "@/lib/logger";

/**
 * Daily faucet. Idempotent on (kind, reference) — the reference is the date,
 * so a second call on the same UTC day returns "already_claimed".
 *
 * Streak bumps when the previous claim was within 36 hours (so a user with
 * a single missed-day window doesn't reset all the way to 1). Reaching
 * multiples of 7 days awards a bonus.
 */
export async function POST() {
  const u = await getAuthedUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10); // "YYYY-MM-DD"
  const reference = `daily:${u.id}:${dateKey}`;
  const reward = dailyReward();

  try {
    const result = await db.$transaction(async (tx) => {
      const me = await tx.user.findUnique({
        where: { id: u.id },
        select: { lastClaimAt: true, streak: true },
      });
      if (!me) throw new Error("user_missing");

      // Streak update
      let nextStreak = 1;
      if (me.lastClaimAt) {
        const gap = now.getTime() - me.lastClaimAt.getTime();
        if (gap < 36 * 60 * 60 * 1000 && gap > 23 * 60 * 60 * 1000) {
          nextStreak = me.streak + 1;
        } else if (gap <= 23 * 60 * 60 * 1000) {
          // already claimed today — return early
          throw new HttpError(409, "already_claimed");
        }
      }

      const bonus = nextStreak > 0 && nextStreak % 7 === 0 ? reward * 2 : reward;

      await tx.transaction.create({
        data: {
          userId: u.id,
          delta: bonus,
          kind: "daily_claim",
          reference,
          metadata: { streak: nextStreak },
        },
      });

      const wallet = await tx.wallet.update({
        where: { userId: u.id },
        data: { balance: { increment: bonus } },
      });
      await tx.user.update({
        where: { id: u.id },
        data: { lastClaimAt: now, streak: nextStreak, xp: { increment: 10 } },
      });
      await tx.reward.create({
        data: { userId: u.id, kind: nextStreak % 7 === 0 ? "streak_7" : "daily", coins: bonus },
      });
      const unlocks = await onDailyClaim(tx, u.id, { streak: nextStreak });
      return { bonus, streak: nextStreak, balance: wallet.balance, unlocks };
    });

    publishUnlocks(u.id, result.unlocks);
    if (result.unlocks.length > 0) {
      publish(Channels.user(u.id), { type: "notification", at: Date.now() });
    }
    return NextResponse.json({
      ok: true,
      bonus: result.bonus,
      streak: result.streak,
      balance: result.balance,
      unlocks: result.unlocks,
    });
  } catch (e) {
    if (e instanceof HttpError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    // Idempotency: the unique index on (kind, reference) trips if the
    // user POSTs twice in the same UTC day.
    if (
      typeof (e as { code?: string }).code === "string" &&
      (e as { code: string }).code === "P2002"
    ) {
      return NextResponse.json({ error: "already_claimed" }, { status: 409 });
    }
    logger.error(e, { route: "/api/rewards/claim", userId: u.id });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
