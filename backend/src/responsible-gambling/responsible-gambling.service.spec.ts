import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
  // PR-RG-2 fields:
  pendingLimits: Record<string, number | null> | null;
  pendingActivatesAt: Date | null;
  sessionStartedAt: Date | null;
  lastSessionPingAt: Date | null;
  lastReminderAt: Date | null;
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
    pendingLimits: null,
    pendingActivatesAt: null,
    sessionStartedAt: null,
    lastSessionPingAt: null,
    lastReminderAt: null,
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
        // Translate Prisma.JsonNull → actual JS null so test assertions
        // can use .toBeNull() rather than dealing with the marker.
        const normalised: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(data)) {
          normalised[k] = v === Prisma.JsonNull ? null : v;
        }
        profile = { ...profile, ...normalised, updatedAt: new Date() } as Profile;
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

  it('stages a raise in pendingLimits with 24h activation (PR-RG-2)', async () => {
    const { svc, prisma, notifications } = makeService({
      profile: makeProfile({ dailyWagerLimitCoins: 2000 }),
    });
    const r = await svc.updateLimits('u-1', { dailyWagerLimitCoins: 5000 });
    // Live value unchanged.
    expect(r.dailyWagerLimitCoins).toBe(2000);
    expect(r.pendingLimits).toEqual({ dailyWagerLimitCoins: 5000 });
    expect(r.pendingActivatesAt).toBeInstanceOf(Date);
    const diff = r.pendingActivatesAt!.getTime() - Date.now();
    expect(diff).toBeGreaterThan(23 * 3_600_000);
    expect(diff).toBeLessThanOrEqual(24 * 3_600_000);
    expect(notifications.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ templateCode: 'rg_pending_raise_v1' }),
    );
    void prisma;
  });

  it('stages removing-limit as a raise (PR-RG-2)', async () => {
    const { svc } = makeService({
      profile: makeProfile({ dailyWagerLimitCoins: 2000 }),
    });
    const r = await svc.updateLimits('u-1', { dailyWagerLimitCoins: null });
    expect(r.dailyWagerLimitCoins).toBe(2000);
    expect(r.pendingLimits).toEqual({ dailyWagerLimitCoins: null });
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

// ─── PR-RG-2: pending raises ──────────────────────────────────────

describe('ResponsibleGamblingService.cancelPendingRaise', () => {
  it('clears the pending bag + writes a forensic event', async () => {
    const future = new Date(Date.now() + 12 * 3_600_000);
    const { svc, prisma } = makeService({
      profile: makeProfile({
        dailyWagerLimitCoins: 2000,
        pendingLimits: { dailyWagerLimitCoins: 5000 },
        pendingActivatesAt: future,
      }),
    });
    const r = await svc.cancelPendingRaise('u-1');
    expect(r.pendingLimits).toBeNull();
    expect(r.pendingActivatesAt).toBeNull();
    expect(prisma._events().some((e: any) => e.limitKind === 'pending_raise_cancelled')).toBe(true);
  });

  it('is a no-op when nothing is pending', async () => {
    const { svc, prisma } = makeService({ profile: makeProfile() });
    await svc.cancelPendingRaise('u-1');
    expect(prisma._events()).toHaveLength(0);
  });
});

describe('ResponsibleGamblingService.applyPendingIfDue', () => {
  it('promotes pending values once the activate moment passes', async () => {
    const past = new Date(Date.now() - 60_000);
    const { svc } = makeService({
      profile: makeProfile({
        dailyWagerLimitCoins: 2000,
        pendingLimits: { dailyWagerLimitCoins: 5000 },
        pendingActivatesAt: past,
      }),
    });
    const r = await svc.applyPendingIfDue('u-1');
    expect(r!.dailyWagerLimitCoins).toBe(5000);
    expect(r!.pendingLimits).toBeNull();
    expect(r!.pendingActivatesAt).toBeNull();
  });

  it('does NOT promote before the activate moment', async () => {
    const future = new Date(Date.now() + 60_000);
    const { svc } = makeService({
      profile: makeProfile({
        dailyWagerLimitCoins: 2000,
        pendingLimits: { dailyWagerLimitCoins: 5000 },
        pendingActivatesAt: future,
      }),
    });
    const r = await svc.applyPendingIfDue('u-1');
    expect(r!.dailyWagerLimitCoins).toBe(2000);
    expect(r!.pendingLimits).toEqual({ dailyWagerLimitCoins: 5000 });
  });

  it('lower + raise in the same PATCH: lower applies, raise stages', async () => {
    const { svc } = makeService({
      profile: makeProfile({
        dailyWagerLimitCoins: 5000,
        weeklyDepositLimitCoins: 10_000,
      }),
    });
    const r = await svc.updateLimits('u-1', {
      dailyWagerLimitCoins: 2000,       // lower → instant
      weeklyDepositLimitCoins: 25_000,  // raise → pending
    });
    expect(r.dailyWagerLimitCoins).toBe(2000);
    expect(r.weeklyDepositLimitCoins).toBe(10_000);
    expect(r.pendingLimits).toEqual({ weeklyDepositLimitCoins: 25_000 });
  });
});

// ─── PR-RG-2: session heartbeat ──────────────────────────────────

describe('ResponsibleGamblingService.recordSessionPing', () => {
  it('starts a fresh session on first ping', async () => {
    const { svc, prisma } = makeService({ profile: makeProfile() });
    const r = await svc.recordSessionPing('u-1');
    expect(r.reminderDue).toBe(false);
    expect(r.minutesElapsed).toBe(0);
    expect(prisma._profile()!.sessionStartedAt).toBeInstanceOf(Date);
    expect(prisma._profile()!.lastSessionPingAt).toBeInstanceOf(Date);
  });

  it('fires reminder when elapsed crosses threshold', async () => {
    // Profile says reminder at 30 min; mock a session that started 31m ago.
    const start = new Date(Date.now() - 31 * 60_000);
    const recent = new Date(Date.now() - 30_000);
    const { svc, notifications } = makeService({
      profile: makeProfile({
        sessionStartedAt: start,
        lastSessionPingAt: recent,
        sessionReminderMinutes: 30,
      }),
    });
    const r = await svc.recordSessionPing('u-1');
    expect(r.reminderDue).toBe(true);
    expect(r.minutesElapsed).toBe(31);
    expect(notifications.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ templateCode: 'rg_session_reminder_v1' }),
    );
  });

  it('does not double-fire reminder in the same session', async () => {
    // Session is 60 min old; we already fired the reminder 5 min ago.
    const start = new Date(Date.now() - 60 * 60_000);
    const recent = new Date(Date.now() - 5 * 60_000);
    const { svc, notifications } = makeService({
      profile: makeProfile({
        sessionStartedAt: start,
        lastSessionPingAt: recent,
        lastReminderAt: new Date(Date.now() - 5 * 60_000),
        sessionReminderMinutes: 30,
      }),
    });
    const r = await svc.recordSessionPing('u-1');
    expect(r.reminderDue).toBe(false);
    expect(notifications.enqueue).not.toHaveBeenCalled();
  });

  it('IDLE_RESET_MS gap restarts the session', async () => {
    // Session was 60 min old, but last ping was 35 min ago (> 30m idle).
    const oldStart = new Date(Date.now() - 60 * 60_000);
    const longAgo = new Date(Date.now() - 35 * 60_000);
    const { svc, prisma } = makeService({
      profile: makeProfile({
        sessionStartedAt: oldStart,
        lastSessionPingAt: longAgo,
        sessionReminderMinutes: 30,
      }),
    });
    const r = await svc.recordSessionPing('u-1');
    expect(r.reminderDue).toBe(false);
    expect(r.minutesElapsed).toBe(0);
    // sessionStartedAt was reset.
    expect(prisma._profile()!.sessionStartedAt!.getTime()).toBeGreaterThan(oldStart.getTime());
  });

  it('also opportunistically applies a due pending raise', async () => {
    const past = new Date(Date.now() - 60_000);
    const { svc, prisma } = makeService({
      profile: makeProfile({
        dailyWagerLimitCoins: 2000,
        pendingLimits: { dailyWagerLimitCoins: 5000 },
        pendingActivatesAt: past,
      }),
    });
    await svc.recordSessionPing('u-1');
    expect(prisma._profile()!.dailyWagerLimitCoins).toBe(5000);
    expect(prisma._profile()!.pendingLimits).toBeNull();
  });
});

// ─── PR-RG-2: getProfile lazy promotion ───────────────────────────

describe('ResponsibleGamblingService.getProfile (lazy promotion)', () => {
  it('promotes a due pending raise on read', async () => {
    const past = new Date(Date.now() - 60_000);
    const { svc } = makeService({
      profile: makeProfile({
        dailyWagerLimitCoins: 2000,
        pendingLimits: { dailyWagerLimitCoins: 5000 },
        pendingActivatesAt: past,
      }),
    });
    const r = await svc.getProfile('u-1');
    expect(r.dailyWagerLimitCoins).toBe(5000);
    expect(r.pendingLimits).toBeNull();
  });
});
