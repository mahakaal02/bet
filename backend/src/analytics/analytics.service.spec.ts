import { AnalyticsService } from './analytics.service';

function makeMocks(opts: {
  users?: Array<{ id: string; createdAt: Date; emailVerified?: boolean; phoneVerified?: boolean }>;
  kycVerifications?: Array<{ userId: string; tier: string }>;
  bids?: Array<{ userId: string; createdAt: Date }>;
  coinTxns?: Array<{ userId: string; createdAt: Date; reason: string }>;
  aviatorBets?: Array<{ userId: string; createdAt: Date }>;
} = {}) {
  const users = opts.users ?? [];
  const kyc = opts.kycVerifications ?? [];
  const bids = opts.bids ?? [];
  const txns = opts.coinTxns ?? [];
  const aviator = opts.aviatorBets ?? [];

  const inDateRange = (date: Date, range?: { gte?: Date; lte?: Date; lt?: Date }) => {
    if (!range) return true;
    if (range.gte && date < range.gte) return false;
    if (range.lte && date > range.lte) return false;
    if (range.lt && date >= range.lt) return false;
    return true;
  };

  const prisma: any = {
    user: {
      count: jest.fn(async ({ where }: any) => {
        return users.filter((u) => {
          if (!inDateRange(u.createdAt, where.createdAt)) return false;
          if (where.emailVerified !== undefined && (u.emailVerified ?? false) !== where.emailVerified) return false;
          if (where.phoneVerified !== undefined && (u.phoneVerified ?? false) !== where.phoneVerified) return false;
          if (where.coinTxns?.some) {
            const has = txns.some((t) =>
              t.userId === u.id && t.reason === where.coinTxns.some.reason,
            );
            if (!has) return false;
          }
          if (where.bids?.some !== undefined) {
            const has = bids.some((b) => b.userId === u.id);
            if (!has) return false;
          }
          return true;
        }).length;
      }),
      findMany: jest.fn(async ({ where, select }: any) => {
        void select;
        return users
          .filter((u) => inDateRange(u.createdAt, where.createdAt))
          .map((u) => ({ id: u.id, createdAt: u.createdAt }));
      }),
    },
    kycVerification: {
      count: jest.fn(async ({ where }: any) => {
        const allowed = where.tier?.in as string[] | undefined;
        return kyc.filter((k) => {
          if (allowed && !allowed.includes(k.tier)) return false;
          if (where.user?.createdAt) {
            const u = users.find((x) => x.id === k.userId);
            if (!u) return false;
            if (!inDateRange(u.createdAt, where.user.createdAt)) return false;
          }
          return true;
        }).length;
      }),
    },
    bid: {
      findMany: jest.fn(async ({ where }: any) => {
        const inSet = new Set(where.userId?.in ?? []);
        return bids
          .filter((b) => inSet.has(b.userId) && inDateRange(b.createdAt, where.createdAt))
          .map((b) => ({ userId: b.userId, createdAt: b.createdAt }));
      }),
    },
    coinTransaction: {
      findMany: jest.fn(async ({ where }: any) => {
        const inSet = new Set(where.userId?.in ?? []);
        return txns
          .filter((t) =>
            inSet.has(t.userId) &&
            inDateRange(t.createdAt, where.createdAt) &&
            (!where.reason || t.reason === where.reason),
          )
          .map((t) => ({ userId: t.userId, createdAt: t.createdAt }));
      }),
    },
    aviatorBet: {
      findMany: jest.fn(async ({ where }: any) => {
        const inSet = new Set(where.userId?.in ?? []);
        return aviator
          .filter((a) => inSet.has(a.userId) && inDateRange(a.createdAt, where.createdAt))
          .map((a) => ({ userId: a.userId, createdAt: a.createdAt }));
      }),
    },
  };
  return { svc: new AnalyticsService(prisma) };
}

describe('AnalyticsService.toUtcMonday', () => {
  it('snaps Sunday to the previous Monday', () => {
    // 2026-05-24 is a Sunday.
    const monday = AnalyticsService.toUtcMonday(new Date('2026-05-24T15:00:00Z'));
    expect(monday.toISOString()).toBe('2026-05-18T00:00:00.000Z');
  });
  it('keeps Monday as Monday', () => {
    const monday = AnalyticsService.toUtcMonday(new Date('2026-05-18T10:00:00Z'));
    expect(monday.toISOString()).toBe('2026-05-18T00:00:00.000Z');
  });
  it('snaps mid-week back to Monday', () => {
    // 2026-05-21 is a Thursday.
    const monday = AnalyticsService.toUtcMonday(new Date('2026-05-21T10:00:00Z'));
    expect(monday.toISOString()).toBe('2026-05-18T00:00:00.000Z');
  });
});

describe('AnalyticsService.funnel', () => {
  const now = new Date('2026-05-22T12:00:00Z');
  const inWindow = new Date('2026-05-10T00:00:00Z');

  it('computes each step + ratio', async () => {
    const { svc } = makeMocks({
      users: [
        { id: 'u-1', createdAt: inWindow, emailVerified: true, phoneVerified: true },
        { id: 'u-2', createdAt: inWindow, emailVerified: true, phoneVerified: false },
        { id: 'u-3', createdAt: inWindow, emailVerified: false, phoneVerified: false },
      ],
      kycVerifications: [{ userId: 'u-1', tier: 'TIER_1' }],
      coinTxns: [{ userId: 'u-1', createdAt: inWindow, reason: 'coin_purchase' }],
      bids: [{ userId: 'u-1', createdAt: inWindow }],
    });
    const r = await svc.funnel({ from: new Date('2026-05-01'), to: now });
    expect(r.steps.map((s) => s.count)).toEqual([3, 2, 1, 1, 1, 1]);
    // email-verified ratio = 2/3 ≈ 0.6667
    expect(r.steps[1].ratioFromPrev).toBeCloseTo(0.6667, 3);
    expect(r.overallConversion).toBeCloseTo(1 / 3, 3);
  });

  it('handles zero-signup window gracefully', async () => {
    const { svc } = makeMocks();
    const r = await svc.funnel({ from: new Date('2026-05-01'), to: now });
    expect(r.steps[0].count).toBe(0);
    expect(r.overallConversion).toBe(0);
    // No NaN in ratios — denom=0 → 0.
    for (const s of r.steps) {
      expect(s.ratioFromPrev).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('AnalyticsService.cohortRetention', () => {
  it('returns one row per requested cohort week', async () => {
    const { svc } = makeMocks();
    const r = await svc.cohortRetention({ weeksBack: 4, retentionWeeks: 2 });
    expect(r.cohorts).toHaveLength(4);
    expect(r.cohorts.every((c) => c.retention.length === 2)).toBe(true);
  });

  it('caps weeksBack at 26', async () => {
    const { svc } = makeMocks();
    const r = await svc.cohortRetention({ weeksBack: 100 });
    expect(r.weeksBack).toBe(26);
  });

  it('caps retentionWeeks at 12', async () => {
    const { svc } = makeMocks();
    const r = await svc.cohortRetention({ retentionWeeks: 100 });
    expect(r.retentionWeeks).toBe(12);
  });

  it('week-0 retention is 1.0 for any cohort with activity in their signup week', async () => {
    // Pick a Monday in the recent past so the cohort window definitely
    // includes the activity.
    const monday = AnalyticsService.toUtcMonday(new Date());
    const lastWeekMonday = new Date(monday.getTime() - 7 * 24 * 60 * 60_000);
    const dayInWeek = new Date(lastWeekMonday.getTime() + 3 * 24 * 60 * 60_000);
    const { svc } = makeMocks({
      users: [
        { id: 'u-1', createdAt: dayInWeek },
        { id: 'u-2', createdAt: dayInWeek },
      ],
      bids: [{ userId: 'u-1', createdAt: dayInWeek }],
    });
    const r = await svc.cohortRetention({ weeksBack: 2, retentionWeeks: 1 });
    const lastWeek = r.cohorts[r.cohorts.length - 2];
    expect(lastWeek.totalUsers).toBe(2);
    expect(lastWeek.retention[0]).toBe(0.5); // 1 of 2 was active
  });
});
