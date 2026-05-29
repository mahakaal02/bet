import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Admin analytics (Roadmap §F-ADMIN-8).
 *
 * Two reports for the first pass:
 *
 *   1. **Funnel** — counts of users at each of:
 *        signup → email-verified → phone-verified → KYC TIER_1 →
 *        first deposit → first bid
 *      Returns absolute counts + conversion ratio between steps.
 *
 *   2. **Cohort retention** — by signup-week, the proportion of
 *      users active in each subsequent week (active = ≥ 1 bid OR
 *      ≥ 1 deposit OR ≥ 1 aviator bet).
 *
 * Both reports run against live tables — no materialised view yet.
 * At ~50k users this is fine; we revisit when the funnel query
 * starts pushing 1s.
 *
 * Date math is all UTC midnight-anchored to keep cohort buckets
 * stable across DST transitions.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Conversion funnel for users who signed up between `from`/`to`.
   * Default window: last 30 days.
   */
  async funnel(input: { from?: Date; to?: Date }): Promise<FunnelReport> {
    const to = input.to ?? new Date();
    const from = input.from ?? new Date(to.getTime() - 30 * 24 * 60 * 60_000);

    const inWindow = { createdAt: { gte: from, lte: to } };

    // Step 1 — signup count.
    const signups = await this.prisma.user.count({ where: inWindow });

    // Step 2 — emailVerified true. `User.emailVerified` flag in the
    // foundation schema; once email-1 lands we'll switch to the
    // verifiedAt timestamp on KycVerification for sharper data, but
    // the boolean is fine for first-pass funnel.
    const emailVerified = await this.prisma.user.count({
      where: { ...inWindow, emailVerified: true },
    });

    // Step 3 — phoneVerified.
    const phoneVerified = await this.prisma.user.count({
      where: { ...inWindow, phoneVerified: true },
    });

    // Step 4 — KYC tier ≥ 1. We approximate via the existence of a
    // KycVerification row with tier in (TIER_1, TIER_2, TIER_3).
    const kycTier1Plus = await this.prisma.kycVerification.count({
      where: {
        tier: { in: ['TIER_1', 'TIER_2', 'TIER_3'] },
        user: inWindow,
      },
    });

    // Step 5 — first deposit (any paid coin-purchase CoinTransaction).
    const firstDeposit = await this.prisma.user.count({
      where: {
        ...inWindow,
        coinTxns: {
          some: { reason: 'coin_purchase' },
        },
      },
    });

    // Step 6 — first bid placed.
    const firstBid = await this.prisma.user.count({
      where: { ...inWindow, bids: { some: {} } },
    });

    const steps: FunnelStep[] = [
      { key: 'signup',           label: 'Signed up',          count: signups,        ratioFromPrev: 1 },
      { key: 'email_verified',   label: 'Email verified',     count: emailVerified,  ratioFromPrev: ratio(emailVerified, signups) },
      { key: 'phone_verified',   label: 'Phone verified',     count: phoneVerified,  ratioFromPrev: ratio(phoneVerified, emailVerified) },
      { key: 'kyc_tier1',        label: 'KYC tier 1+',        count: kycTier1Plus,   ratioFromPrev: ratio(kycTier1Plus, phoneVerified) },
      { key: 'first_deposit',    label: 'First deposit',      count: firstDeposit,   ratioFromPrev: ratio(firstDeposit, kycTier1Plus) },
      { key: 'first_bid',        label: 'First bid',          count: firstBid,       ratioFromPrev: ratio(firstBid, firstDeposit) },
    ];

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      steps,
      overallConversion: ratio(firstBid, signups),
    };
  }

  /**
   * Weekly cohort retention. Each cohort is users who signed up in a
   * given UTC week (Mon-Sun). Each cell is the proportion of that
   * cohort active during week-N-after-signup.
   *
   * `weeksBack`: how many cohort weeks to include (default 8).
   * `retentionWeeks`: how many follow-up weeks to compute (default 4).
   */
  async cohortRetention(input: { weeksBack?: number; retentionWeeks?: number }): Promise<CohortReport> {
    const weeksBack = Math.min(26, Math.max(1, input.weeksBack ?? 8));
    const retentionWeeks = Math.min(12, Math.max(1, input.retentionWeeks ?? 4));

    const WEEK_MS = 7 * 24 * 60 * 60_000;
    const now = new Date();
    const currentMonday = AnalyticsService.toUtcMonday(now);
    // Cohorts run oldest → newest. Cohort i begins `oldestStart + i*WEEK`.
    const oldestStart = new Date(currentMonday.getTime() - (weeksBack - 1) * WEEK_MS);
    // Latest retention window we could ever need is cohort (weeksBack-1)
    // at retention week (retentionWeeks-1), which ends here.
    const horizonEnd = new Date(
      oldestStart.getTime() + (weeksBack + retentionWeeks - 1) * WEEK_MS,
    );
    // Global week grid anchored at the oldest cohort's Monday. Because
    // every cohort Monday is 7-day-aligned to this same grid, cohort i's
    // retention-week r window is *exactly* global week (i + r) — which is
    // what lets us bucket all activity once instead of querying per cell.
    const weekIndex = (t: Date): number =>
      Math.floor((t.getTime() - oldestStart.getTime()) / WEEK_MS);

    // (1) One query for every user who signed up anywhere in the cohort
    //     span, bucketed into their signup-week cohort. (Was one query
    //     per cohort week.)
    const users = await this.prisma.user.findMany({
      where: {
        createdAt: { gte: oldestStart, lt: new Date(currentMonday.getTime() + WEEK_MS) },
      },
      select: { id: true, createdAt: true },
    });
    const cohortOfUser = new Map<string, number>();
    const cohortTotals = new Array<number>(weeksBack).fill(0);
    for (const u of users) {
      const i = weekIndex(u.createdAt);
      if (i < 0 || i >= weeksBack) continue;
      cohortOfUser.set(u.id, i);
      cohortTotals[i] += 1;
    }

    // (2) All activity for those users across the whole horizon in 3
    //     queries total (was 3 per cohort×retention cell → up to ~960).
    //     We record, per user, the set of global weeks in which they did
    //     anything (bid OR coin purchase OR aviator bet).
    const userIds = [...cohortOfUser.keys()];
    const activeWeeks = new Map<string, Set<number>>();
    const mark = (userId: string, t: Date) => {
      const g = weekIndex(t);
      if (g < 0) return;
      let s = activeWeeks.get(userId);
      if (!s) {
        s = new Set<number>();
        activeWeeks.set(userId, s);
      }
      s.add(g);
    };
    if (userIds.length > 0) {
      const window = { gte: oldestStart, lt: horizonEnd };
      const [bids, txns, aviator] = await Promise.all([
        this.prisma.bid.findMany({
          where: { userId: { in: userIds }, createdAt: window },
          select: { userId: true, createdAt: true },
        }),
        this.prisma.coinTransaction.findMany({
          where: { userId: { in: userIds }, createdAt: window, reason: 'coin_purchase' },
          select: { userId: true, createdAt: true },
        }),
        this.prisma.aviatorBet.findMany({
          where: { userId: { in: userIds }, createdAt: window },
          select: { userId: true, createdAt: true },
        }),
      ]);
      bids.forEach((b) => mark(b.userId, b.createdAt));
      txns.forEach((t) => mark(t.userId, t.createdAt));
      aviator.forEach((a) => mark(a.userId, a.createdAt));
    }

    // (3) counts[i][r] = # of cohort-i users active in global week (i+r).
    const counts: number[][] = Array.from({ length: weeksBack }, () =>
      new Array<number>(retentionWeeks).fill(0),
    );
    for (const [userId, weeks] of activeWeeks) {
      const i = cohortOfUser.get(userId);
      if (i === undefined) continue;
      for (const g of weeks) {
        const r = g - i;
        if (r >= 0 && r < retentionWeeks) counts[i][r] += 1;
      }
    }

    const cohorts: CohortRow[] = [];
    for (let i = 0; i < weeksBack; i++) {
      const cohortStart = new Date(oldestStart.getTime() + i * WEEK_MS);
      const totalUsers = cohortTotals[i];
      const retention: number[] = [];
      for (let r = 0; r < retentionWeeks; r++) {
        // Future windows have no events → 0, matching the old explicit
        // `winStart > now` guard. Empty cohorts → 0 (no divide-by-zero).
        retention.push(totalUsers === 0 ? 0 : counts[i][r] / totalUsers);
      }
      cohorts.push({ cohortWeekStart: cohortStart.toISOString(), totalUsers, retention });
    }
    return { weeksBack, retentionWeeks, cohorts };
  }

  /** UTC Monday of the week containing `d`. */
  static toUtcMonday(d: Date): Date {
    const day = d.getUTCDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
    const diff = (day + 6) % 7; // days since Monday
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
  }
}

function ratio(num: number, denom: number): number {
  if (denom === 0) return 0;
  return Number((num / denom).toFixed(4));
}

export interface FunnelStep {
  key: string;
  label: string;
  count: number;
  /** Conversion from the prior step (1 for the first step). */
  ratioFromPrev: number;
}

export interface FunnelReport {
  from: string;
  to: string;
  steps: FunnelStep[];
  overallConversion: number;
}

export interface CohortRow {
  cohortWeekStart: string;
  totalUsers: number;
  /** retention[i] = proportion active in week i after signup (0…1). */
  retention: number[];
}

export interface CohortReport {
  weeksBack: number;
  retentionWeeks: number;
  cohorts: CohortRow[];
}
