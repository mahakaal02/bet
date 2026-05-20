import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ResponsibleGamblingService } from './responsible-gambling.service';

/**
 * Service tests focus on:
 *
 *   1. Limit changes: lower=instant, raise=refused, removing=refused.
 *   2. Cool-down + self-exclusion math: timestamps land in the future,
 *      attempts to start a second one while one is in effect 400.
 *   3. Login gate: cooldown / self-exclusion block; expired ones don't.
 *   4. Bet gate: daily-wager limit math, cooldown / self-exclusion
 *      defence-in-depth, audit row on every block.
 *
 * Prisma is mocked with a single mutable profile + a bid list +
 * an event list, all in-memory.
 */

type Profile = {
  userId: string;
  dailyDepositLimitCoins: number | null;
  weeklyDepositLimitCoins: number | null;
  monthlyDepositLimitCoins: number | null;
  dailyLossLimitCoins: number | null;
  weeklyLossLimitCoins: number | null;
  monthlyLossLimitCoins: number | null;
  dailyWagerLimitCoins: number | null;
  sessionReminderMinutes: number;
  cooldownUntil: Date | null;
  selfExcludedUntil: Date | null;
  selfExcludedAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
};

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    userId: 'u-1',
    dailyDepositLimitCoins: null,
    weeklyDepositLimitCoins: null,
    monthlyDepositLimitCoins: null,
    dailyLossLimitCoins: null,
    weeklyLossLimitCoins: null,
    monthlyLossLimitCoins: null,
    dailyWagerLimitCoins: null,
    sessionReminderMinutes: 30,
    cooldownUntil: null,
    selfExcludedUntil: null,
    selfExcludedAt: null,
    updatedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

function makePrismaMock(opts: {
  profile?: Profile | null;
  bidsToday?: Array<{ auction: { coinsPerBid: number } }>;
} = {}) {
  let profile: Profile | null = opts.profile ?? null;
  const events: any[] = [];
  return {
    responsibleGamblingProfile: {
      findUnique: jest.fn(async () => profile),
      upsert: jest.fn(async ({ create }: any) => {
        if (!profile) {
          profile = makeProfile({ userId: create.userId });
        }
        return profile;
      }),
      update: jest.fn(async ({ data }: any) => {
        if (!profile) throw new Error('no profile');
        profile = { ...profile, ...data, updatedAt: new Date() };
        return profile;
      }),
    },
    responsibleGamblingEvent: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `e-${events.length + 1}`, createdAt: new Date(), ...data };
        events.push(row);
        return row;
      }),
      createMany: jest.fn(async ({ data }: any) => {
        for (const d of data) {
          events.push({ id: `e-${events.length + 1}`, createdAt: new Date(), ...d });
        }
        return { count: data.length };
      }),
      findMany: jest.fn(async () => events.slice().reverse()),
    },
    bid: {
      findMany: jest.fn(async () => opts.bidsToday ?? []),
    },
    _profile: () => profile,
    _events: () => events,
  };
}

function makeService(opts: Parameters<typeof makePrismaMock>[0] = {}) {
  const prisma = makePrismaMock(opts);
  const notifications = { enqueue: jest.fn(async (_args: any) => [] as unknown[]) };
  return {
    svc: new ResponsibleGamblingService(prisma as any, notifications as any),
    prisma,
    notifications,
  };
}

describe('ResponsibleGamblingService.updateLimits', () => {
  it('sets a limit for the first time (null → number = lower)', async () => {
    const { svc, prisma } = makeService({ profile: makeProfile() });
    const r = await svc.updateLimits('u-1', { dailyWagerLimitCoins: 5000 });
    expect(r.dailyWagerLimitCoins).toBe(5000);
    expect(prisma._events().some((e: any) => e.limitKind === 'dailyWagerLimitCoins')).toBe(true);
  });

  it('lowers an existing limit instantly', async () => {
    const { svc } = makeService({
      profile: makeProfile({ dailyWagerLimitCoins: 5000 }),
    });
    const r = await svc.updateLimits('u-1', { dailyWagerLimitCoins: 2000 });
    expect(r.dailyWagerLimitCoins).toBe(2000);
  });

  it('refuses to raise an existing limit', async () => {
    const { svc } = makeService({
      profile: makeProfile({ dailyWagerLimitCoins: 2000 }),
    });
    await expect(
      svc.updateLimits('u-1', { dailyWagerLimitCoins: 5000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to remove an existing limit (treated as raise)', async () => {
    const { svc } = makeService({
      profile: makeProfile({ dailyWagerLimitCoins: 2000 }),
    });
    await expect(
      svc.updateLimits('u-1', { dailyWagerLimitCoins: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400s on negative or non-integer limit', async () => {
    const { svc } = makeService({ profile: makeProfile() });
    await expect(
      svc.updateLimits('u-1', { dailyWagerLimitCoins: -100 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.updateLimits('u-1', { dailyWagerLimitCoins: 1.5 as any }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows session reminder to move in either direction', async () => {
    const { svc } = makeService({
      profile: makeProfile({ sessionReminderMinutes: 30 }),
    });
    const r1 = await svc.updateLimits('u-1', { sessionReminderMinutes: 15 });
    expect(r1.sessionReminderMinutes).toBe(15);
    const r2 = await svc.updateLimits('u-1', { sessionReminderMinutes: 60 });
    expect(r2.sessionReminderMinutes).toBe(60);
  });

  it('400s on out-of-range session reminder', async () => {
    const { svc } = makeService({ profile: makeProfile() });
    await expect(
      svc.updateLimits('u-1', { sessionReminderMinutes: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.updateLimits('u-1', { sessionReminderMinutes: 9999 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ResponsibleGamblingService.startCooldown', () => {
  it('sets cooldownUntil ~24h in the future for day1', async () => {
    const { svc, prisma } = makeService({ profile: makeProfile() });
    const r = await svc.startCooldown('u-1', 'day1');
    const diff = r.cooldownUntil!.getTime() - Date.now();
    expect(diff).toBeGreaterThan(23 * 3_600_000);
    expect(diff).toBeLessThanOrEqual(24 * 3_600_000);
    expect(prisma._events().some((e: any) => e.kind === 'COOLDOWN_STARTED')).toBe(true);
  });

  it('refuses to start a second cool-down while one is in effect', async () => {
    const future = new Date(Date.now() + 60 * 60_000);
    const { svc } = makeService({
      profile: makeProfile({ cooldownUntil: future }),
    });
    await expect(svc.startCooldown('u-1', 'day7')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('ResponsibleGamblingService.startSelfExclusion', () => {
  it('sets selfExcludedUntil for fixed durations', async () => {
    const { svc } = makeService({ profile: makeProfile() });
    const r = await svc.startSelfExclusion('u-1', 'day7');
    expect(r.selfExcludedAt).toBeInstanceOf(Date);
    expect(r.selfExcludedUntil).toBeInstanceOf(Date);
    expect(
      r.selfExcludedUntil!.getTime() - r.selfExcludedAt!.getTime(),
    ).toBeLessThanOrEqual(7 * 24 * 3_600_000);
  });

  it('permanent exclusion has selfExcludedAt set, selfExcludedUntil null', async () => {
    const { svc } = makeService({ profile: makeProfile() });
    const r = await svc.startSelfExclusion('u-1', 'permanent');
    expect(r.selfExcludedAt).toBeInstanceOf(Date);
    expect(r.selfExcludedUntil).toBeNull();
  });

  it('refuses to re-self-exclude while one is in effect', async () => {
    const { svc } = makeService({
      profile: makeProfile({ selfExcludedAt: new Date() }),
    });
    await expect(svc.startSelfExclusion('u-1', 'day7')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('ResponsibleGamblingService.assertCanLogin', () => {
  it('allows when no profile', async () => {
    const { svc } = makeService({ profile: null });
    await expect(svc.assertCanLogin('u-1')).resolves.toBeUndefined();
  });

  it('blocks during active cool-down', async () => {
    const { svc } = makeService({
      profile: makeProfile({
        cooldownUntil: new Date(Date.now() + 60 * 60_000),
      }),
    });
    await expect(svc.assertCanLogin('u-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows after cool-down expires', async () => {
    const { svc } = makeService({
      profile: makeProfile({
        cooldownUntil: new Date(Date.now() - 1_000),
      }),
    });
    await expect(svc.assertCanLogin('u-1')).resolves.toBeUndefined();
  });

  it('blocks during fixed-duration self-exclusion', async () => {
    const now = new Date();
    const { svc } = makeService({
      profile: makeProfile({
        selfExcludedAt: now,
        selfExcludedUntil: new Date(now.getTime() + 60 * 60_000),
      }),
    });
    await expect(svc.assertCanLogin('u-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('blocks permanently on permanent self-exclusion', async () => {
    const { svc } = makeService({
      profile: makeProfile({
        selfExcludedAt: new Date(),
        selfExcludedUntil: null,
      }),
    });
    await expect(svc.assertCanLogin('u-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows after fixed self-exclusion expires', async () => {
    const { svc } = makeService({
      profile: makeProfile({
        selfExcludedAt: new Date(Date.now() - 86_400_000),
        selfExcludedUntil: new Date(Date.now() - 1_000),
      }),
    });
    await expect(svc.assertCanLogin('u-1')).resolves.toBeUndefined();
  });
});

describe('ResponsibleGamblingService.assertCanBet', () => {
  it('allows when no profile', async () => {
    const { svc } = makeService({ profile: null });
    await expect(svc.assertCanBet('u-1', 100)).resolves.toBeUndefined();
  });

  it('allows when profile has no wager limit', async () => {
    const { svc } = makeService({ profile: makeProfile() });
    await expect(svc.assertCanBet('u-1', 100)).resolves.toBeUndefined();
  });

  it('allows when sum + this < limit', async () => {
    const { svc } = makeService({
      profile: makeProfile({ dailyWagerLimitCoins: 1000 }),
      bidsToday: [
        { auction: { coinsPerBid: 100 } },
        { auction: { coinsPerBid: 200 } },
      ],
    });
    await expect(svc.assertCanBet('u-1', 100)).resolves.toBeUndefined();   // 300+100=400 ≤ 1000
  });

  it('blocks + audits when sum + this > limit', async () => {
    const { svc, prisma } = makeService({
      profile: makeProfile({ dailyWagerLimitCoins: 300 }),
      bidsToday: [
        { auction: { coinsPerBid: 200 } },
        { auction: { coinsPerBid: 100 } },
      ],
    });
    await expect(svc.assertCanBet('u-1', 50)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(
      prisma._events().some((e: any) => e.kind === 'BET_BLOCKED_BY_LIMIT'),
    ).toBe(true);
  });

  it('blocks on cooldown even when wager would be under', async () => {
    const { svc } = makeService({
      profile: makeProfile({
        dailyWagerLimitCoins: 10_000,
        cooldownUntil: new Date(Date.now() + 60 * 60_000),
      }),
    });
    await expect(svc.assertCanBet('u-1', 100)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('blocks on self-exclusion even when wager would be under', async () => {
    const { svc } = makeService({
      profile: makeProfile({
        dailyWagerLimitCoins: 10_000,
        selfExcludedAt: new Date(),
        selfExcludedUntil: new Date(Date.now() + 86_400_000),
      }),
    });
    await expect(svc.assertCanBet('u-1', 100)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
