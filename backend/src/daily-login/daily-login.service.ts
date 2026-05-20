import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BetWalletService } from '../bet-wallet/bet-wallet.service';
import { SettingsService } from '../foundation/settings.service';
import { NotificationService } from '../foundation/notification.service';

/**
 * Daily-login streak rewards (Roadmap §F-USER-8).
 *
 * Lifecycle
 *
 *   1. `getState(userId)` — returns streak count, today's reward
 *      preview (or "already claimed"), claim eligibility flags.
 *      Used by the auctions hub card to render the CTA.
 *
 *   2. `claim(userId)` — if eligible: insert a `DailyLoginClaim`
 *      row keyed on `(userId, claimDateUtc)`, advance streak,
 *      credit coins via `BetWalletService.credit()` keyed on the
 *      claim id (idempotent).
 *
 * Streak math
 *
 *   - The streak day counts in "calendar UTC days". Two claims
 *     that land within the same UTC day are blocked by the unique
 *     constraint on `(userId, claimDateUtc)`. Claims after the
 *     deadline reset the streak to day 1.
 *
 *   - Deadline: `lastClaimAt + 26h`. The 2h grace beyond a
 *     pure-24h window lets a user who claimed at 23:59 yesterday
 *     still claim today before midnight without losing streak.
 *     Past that, the streak resets unless a freeze is spent.
 *
 *   - Streak freezes: max 3 stored per user. One is earned every
 *     14 consecutive days. On a missed-day check, if the user has
 *     at least one freeze AND was on a streak of ≥ 7 days, the
 *     freeze is spent and the streak continues. We keep the
 *     spend-on-claim semantics (so the user only spends a freeze
 *     when they actually come back to claim, not in a background
 *     job — fewer surprises in the UX).
 *
 * Reward table
 *
 *   Stored in `SystemSetting.daily_login.rewards` as a JSON array of
 *   `{ day, coins, bonus? }`. Missing days interpolate linearly
 *   between the surrounding declared days. After day 30 the streak
 *   loops back to day 1 with a permanent "loyalty" marker (handled
 *   by the controller, not here).
 *
 *   We resolve the catalog through `SettingsService` so an admin
 *   can tune rewards from the Settings UI without a redeploy.
 *
 * Idempotency
 *
 *   - DB-level: `@@unique([userId, claimDateUtc])` on the claim
 *     row prevents double-claim in the same UTC day.
 *   - Wallet-level: credit is called with `reference =
 *     "daily_login:<claim.id>"` so a retry never double-credits.
 *
 * Notifications
 *
 *   `daily_streak_v1` (INAPP only — push is opt-in and would
 *   spam users on auto-claim flows). The body carries the day
 *   number and coin amount so the renderer doesn't need the
 *   reward catalog.
 */

const SETTING_KEY = 'daily_login.rewards';

interface RewardEntry {
  day: number;
  coins: number;
  bonus?: string;
}

const DEFAULT_REWARDS: RewardEntry[] = [
  { day: 1, coins: 50 },
  { day: 2, coins: 75 },
  { day: 3, coins: 100 },
  { day: 7, coins: 300, bonus: 'first_week' },
  { day: 14, coins: 700 },
  { day: 30, coins: 2000, bonus: 'loyalty' },
];

const GRACE_MS = 2 * 60 * 60_000;                    // 2h after midnight
const STREAK_BREAK_MS = 24 * 60 * 60_000 + GRACE_MS; // 26h total
const FREEZE_EARN_EVERY = 14;                        // days
const FREEZE_MAX = 3;
const FREEZE_MIN_STREAK_TO_SPEND = 7;
const STREAK_CYCLE_LENGTH = 30;

@Injectable()
export class DailyLoginService {
  private readonly logger = new Logger(DailyLoginService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly betWallet: BetWalletService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationService,
  ) {}

  async getState(userId: string, now = new Date()) {
    const row = await this.prisma.dailyLogin.findUnique({ where: { userId } });
    const todayUtc = startOfUtcDay(now);

    const claimedToday = await this.prisma.dailyLoginClaim.findUnique({
      where: { userId_claimDateUtc: { userId, claimDateUtc: todayUtc } },
    });

    const projected = projectNextDay(row, now);
    const rewards = await this.loadRewards();
    const nextReward = rewardForDay(projected.dayNumber, rewards);

    return {
      streak: row?.streak ?? 0,
      lastClaimAt: row?.lastClaimAt?.toISOString() ?? null,
      streakFreezes: row?.streakFreezes ?? 0,
      claimedToday: !!claimedToday,
      nextClaim: claimedToday
        ? null
        : {
            dayNumber: projected.dayNumber,
            rewardCoins: nextReward.coins,
            bonus: nextReward.bonus ?? null,
            freezeWouldBeSpent: projected.willSpendFreeze,
          },
      // Next claim window opens at the next UTC midnight when one
      // was already claimed today. UI uses this to render the timer.
      nextClaimAt: claimedToday
        ? new Date(todayUtc.getTime() + 24 * 60 * 60_000).toISOString()
        : null,
    };
  }

  async claim(userId: string, now = new Date()) {
    const todayUtc = startOfUtcDay(now);
    const existing = await this.prisma.dailyLoginClaim.findUnique({
      where: { userId_claimDateUtc: { userId, claimDateUtc: todayUtc } },
    });
    if (existing) {
      throw new ConflictException('today\'s reward has already been claimed');
    }

    const row = await this.prisma.dailyLogin.findUnique({ where: { userId } });
    const projected = projectNextDay(row, now);
    const rewards = await this.loadRewards();
    const reward = rewardForDay(projected.dayNumber, rewards);
    if (reward.coins < 0) {
      throw new BadRequestException('invalid reward configuration');
    }

    // Bonus freeze earned when crossing a 14-day milestone.
    const newStreakFreezes = computeFreezesAfter({
      currentFreezes: row?.streakFreezes ?? 0,
      spent: projected.willSpendFreeze,
      newDayNumber: projected.dayNumber,
    });

    // Persist the claim + advance the DailyLogin row atomically.
    // The wallet credit is OUTSIDE the transaction so a wallet-host
    // outage doesn't roll back the claim — better to have the claim
    // recorded + retry the credit later than to keep retrying the
    // whole flow and produce duplicate claims.
    const claim = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dailyLoginClaim.create({
        data: {
          userId,
          dayNumber: projected.dayNumber,
          rewardCoins: reward.coins,
          claimDateUtc: todayUtc,
        },
      });
      await tx.dailyLogin.upsert({
        where: { userId },
        update: {
          streak: projected.dayNumber,
          lastClaimAt: now,
          streakFreezes: newStreakFreezes,
        },
        create: {
          userId,
          streak: projected.dayNumber,
          lastClaimAt: now,
          streakFreezes: newStreakFreezes,
        },
      });
      return created;
    });

    try {
      await this.betWallet.credit({
        userId,
        amount: reward.coins,
        kind: 'daily_login',
        reference: `daily_login:${claim.id}`,
        metadata: {
          dayNumber: projected.dayNumber,
          bonus: reward.bonus ?? null,
          claimDateUtc: todayUtc.toISOString(),
        },
      });
    } catch (err) {
      // We deliberately do NOT roll back the claim row — keeping it
      // means a retry of the credit (manual or future job) will be
      // idempotent under the `reference` key. The error surfaces to
      // the caller so the UI can show a retry CTA.
      this.logger.error(
        `wallet credit failed for daily login claim ${claim.id}: ${(err as Error).message}`,
      );
      throw err;
    }

    // Best-effort notification. Fire-and-forget so a notification
    // failure can never break the claim flow.
    void this.notifications
      .enqueue({
        templateCode: 'daily_streak_v1',
        userId,
        payload: {
          dayNumber: String(projected.dayNumber),
          rewardCoins: String(reward.coins),
          bonus: reward.bonus ?? '',
        },
        idempotencyAnchor: `daily_streak:${claim.id}`,
        channels: [NotificationChannel.INAPP],
      })
      .catch((err) => {
        this.logger.warn(
          `daily_streak notification enqueue failed: ${(err as Error).message}`,
        );
      });

    return {
      dayNumber: projected.dayNumber,
      rewardCoins: reward.coins,
      bonus: reward.bonus ?? null,
      freezesRemaining: newStreakFreezes,
      streakAfter: projected.dayNumber,
    };
  }

  private async loadRewards(): Promise<RewardEntry[]> {
    return this.settings.getJson<RewardEntry[]>(SETTING_KEY, DEFAULT_REWARDS);
  }
}

// ─── Pure helpers (exported for testing) ────────────────────────────

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Decide what day-number the next claim would land on, and whether
 * a streak freeze would have to be spent to keep it intact.
 *
 * Cases:
 *   - No row yet, or empty streak  → day 1, no freeze
 *   - lastClaimAt within 26h window → day = streak + 1 (modulo cycle), no freeze
 *   - Past 26h window but streak ≥ 7 AND streakFreezes ≥ 1
 *                                  → day = streak + 1, SPEND freeze
 *   - Past 26h window otherwise    → day 1 (reset), no freeze
 */
export function projectNextDay(
  row: {
    streak: number;
    lastClaimAt: Date | null;
    streakFreezes: number;
  } | null,
  now: Date,
): { dayNumber: number; willSpendFreeze: boolean } {
  if (!row || row.streak === 0 || !row.lastClaimAt) {
    return { dayNumber: 1, willSpendFreeze: false };
  }
  const ageMs = now.getTime() - row.lastClaimAt.getTime();
  if (ageMs <= STREAK_BREAK_MS) {
    return {
      dayNumber: nextInCycle(row.streak),
      willSpendFreeze: false,
    };
  }
  // Past the grace window.
  if (
    row.streak >= FREEZE_MIN_STREAK_TO_SPEND &&
    row.streakFreezes >= 1
  ) {
    return {
      dayNumber: nextInCycle(row.streak),
      willSpendFreeze: true,
    };
  }
  return { dayNumber: 1, willSpendFreeze: false };
}

function nextInCycle(streak: number): number {
  // Streak loops 1..30 forever; day 31 = day 1 again (the loyalty
  // bonus on day 30 already happened; the post-loop cycle starts
  // fresh at day 1 but the loyalty marker is permanent — that's a
  // controller-level flag, not part of the math here).
  const next = streak + 1;
  if (next > STREAK_CYCLE_LENGTH) return 1;
  return next;
}

export function computeFreezesAfter(input: {
  currentFreezes: number;
  spent: boolean;
  newDayNumber: number;
}): number {
  let next = input.spent ? input.currentFreezes - 1 : input.currentFreezes;
  // Earn one freeze every FREEZE_EARN_EVERY days, capped at FREEZE_MAX.
  if (input.newDayNumber % FREEZE_EARN_EVERY === 0) {
    next = Math.min(FREEZE_MAX, next + 1);
  }
  if (next < 0) next = 0;
  return next;
}

export function rewardForDay(day: number, rewards: RewardEntry[]): RewardEntry {
  const sorted = [...rewards].sort((a, b) => a.day - b.day);
  // Exact match?
  const exact = sorted.find((r) => r.day === day);
  if (exact) return exact;

  // Below first declared → use first.
  if (day < sorted[0].day) return sorted[0];
  // Above last declared → use last.
  if (day > sorted[sorted.length - 1].day) return sorted[sorted.length - 1];

  // Linear interpolation between two surrounding entries.
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i];
    const hi = sorted[i + 1];
    if (day > lo.day && day < hi.day) {
      const t = (day - lo.day) / (hi.day - lo.day);
      const coins = Math.round(lo.coins + t * (hi.coins - lo.coins));
      return { day, coins };
    }
  }
  // Fallback — shouldn't reach here given the bracketing checks above.
  return sorted[sorted.length - 1];
}
