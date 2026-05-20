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

    // Step 5 — first deposit (any razorpay_purchase CoinTransaction).
    const firstDeposit = await this.prisma.user.count({
      where: {
        ...inWindow,
        coinTxns: {
          some: { reason: 'razorpay_purchase' },
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

    const now = new Date();
    const currentMonday = AnalyticsService.toUtcMonday(now);

    const cohorts: CohortRow[] = [];
    for (let w = weeksBack - 1; w >= 0; w--) {
      const cohortStart = new Date(currentMonday.getTime() - w * 7 * 24 * 60 * 60_000);
      const cohortEnd = new Date(cohortStart.getTime() + 7 * 24 * 60 * 60_000);

      const cohortUserIds = await this.prisma.user.findMany({
        where: { createdAt: { gte: cohortStart, lt: cohortEnd } },
        select: { id: true },
      });
      const totalUsers = cohortUserIds.length;
      const ids = cohortUserIds.map((u) => u.id);

      const retention: number[] = [];
      for (let r = 0; r < retentionWeeks; r++) {
        const winStart = new Date(cohortStart.getTime() + r * 7 * 24 * 60 * 60_000);
        const winEnd = new Date(winStart.getTime() + 7 * 24 * 60 * 60_000);

        if (totalUsers === 0) {
          retention.push(0);
          continue;
        }
        if (winStart.getTime() > now.getTime()) {
          retention.push(0);
          continue;
        }

        const activeIds = await this.activeUserIds(ids, winStart, winEnd);
        retention.push(activeIds.size / totalUsers);
      }

      cohorts.push({
        cohortWeekStart: cohortStart.toISOString(),
        totalUsers,
        retention,
      });
    }
    return { weeksBack, retentionWeeks, cohorts };
  }

  /** Unique users active (bid OR deposit OR aviator bet) in the window. */
  private async activeUserIds(candidates: string[], from: Date, to: Date): Promise<Set<string>> {
    if (candidates.length === 0) return new Set();
    const active = new Set<string>();
    const bids = await this.prisma.bid.findMany({
      where: { userId: { in: candidates }, createdAt: { gte: from, lt: to } },
      select: { userId: true },
      distinct: ['userId'],
    });
    bids.forEach((b) => active.add(b.userId));

    const txns = await this.prisma.coinTransaction.findMany({
      where: {
        userId: { in: candidates },
        createdAt: { gte: from, lt: to },
        reason: 'razorpay_purchase',
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    txns.forEach((t) => active.add(t.userId));

    const aviator = await this.prisma.aviatorBet.findMany({
      where: { userId: { in: candidates }, createdAt: { gte: from, lt: to } },
      select: { userId: true },
      distinct: ['userId'],
    });
    aviator.forEach((a) => active.add(a.userId));
    return active;
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
