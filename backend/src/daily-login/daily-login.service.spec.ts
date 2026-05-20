import { ConflictException } from '@nestjs/common';
import {
  DailyLoginService,
  computeFreezesAfter,
  projectNextDay,
  rewardForDay,
  startOfUtcDay,
} from './daily-login.service';

/**
 * Daily-login tests. The pure math (projectNextDay, rewardForDay,
 * computeFreezesAfter) gets its own block because that's where any
 * subtle off-by-one is most likely to hide. The service-level
 * tests cover the happy claim path, the duplicate guard, and the
 * wallet-failure semantics.
 */

const TODAY = new Date('2026-05-20T12:00:00Z');
const TODAY_UTC = startOfUtcDay(TODAY);

describe('rewardForDay', () => {
  const table = [
    { day: 1, coins: 50 },
    { day: 3, coins: 100 },
    { day: 7, coins: 300, bonus: 'first_week' as const },
    { day: 14, coins: 700 },
    { day: 30, coins: 2000, bonus: 'loyalty' as const },
  ];

  it('returns the exact match for a declared day', () => {
    expect(rewardForDay(7, table)).toEqual({
      day: 7,
      coins: 300,
      bonus: 'first_week',
    });
  });

  it('interpolates linearly between two declared days', () => {
    // day 5 is between 3 (100) and 7 (300): (5-3)/(7-3) = 0.5 → 200.
    expect(rewardForDay(5, table)).toEqual({ day: 5, coins: 200 });
  });

  it('clamps to last when above', () => {
    expect(rewardForDay(45, table).coins).toBe(2000);
  });

  it('clamps to first when below', () => {
    expect(rewardForDay(0, table).coins).toBe(50);
  });
});

describe('projectNextDay', () => {
  it('first-ever claim → day 1', () => {
    expect(projectNextDay(null, TODAY)).toEqual({
      dayNumber: 1,
      willSpendFreeze: false,
    });
  });

  it('within the 26h window → streak+1', () => {
    const row = {
      streak: 5,
      lastClaimAt: new Date(TODAY.getTime() - 20 * 3_600_000),
      streakFreezes: 0,
    };
    expect(projectNextDay(row, TODAY).dayNumber).toBe(6);
    expect(projectNextDay(row, TODAY).willSpendFreeze).toBe(false);
  });

  it('past 26h with no freeze → resets to day 1', () => {
    const row = {
      streak: 5,
      lastClaimAt: new Date(TODAY.getTime() - 36 * 3_600_000),
      streakFreezes: 0,
    };
    expect(projectNextDay(row, TODAY)).toEqual({
      dayNumber: 1,
      willSpendFreeze: false,
    });
  });

  it('past 26h, streak ≥ 7, freezes ≥ 1 → keeps streak by spending', () => {
    const row = {
      streak: 10,
      lastClaimAt: new Date(TODAY.getTime() - 48 * 3_600_000),
      streakFreezes: 1,
    };
    expect(projectNextDay(row, TODAY)).toEqual({
      dayNumber: 11,
      willSpendFreeze: true,
    });
  });

  it('past 26h, streak < 7 → no freeze spend, resets', () => {
    const row = {
      streak: 5,
      lastClaimAt: new Date(TODAY.getTime() - 36 * 3_600_000),
      streakFreezes: 3,
    };
    expect(projectNextDay(row, TODAY).dayNumber).toBe(1);
    expect(projectNextDay(row, TODAY).willSpendFreeze).toBe(false);
  });

  it('loops back to day 1 after day 30', () => {
    const row = {
      streak: 30,
      lastClaimAt: new Date(TODAY.getTime() - 1 * 3_600_000),
      streakFreezes: 0,
    };
    expect(projectNextDay(row, TODAY).dayNumber).toBe(1);
  });
});

describe('computeFreezesAfter', () => {
  it('earns a freeze on day 14', () => {
    expect(
      computeFreezesAfter({ currentFreezes: 0, spent: false, newDayNumber: 14 }),
    ).toBe(1);
  });

  it('does NOT earn on non-multiples-of-14', () => {
    expect(
      computeFreezesAfter({ currentFreezes: 0, spent: false, newDayNumber: 13 }),
    ).toBe(0);
  });

  it('caps at 3', () => {
    expect(
      computeFreezesAfter({ currentFreezes: 3, spent: false, newDayNumber: 14 }),
    ).toBe(3);
  });

  it('spending decrements, then earning may add (net change: 0)', () => {
    expect(
      computeFreezesAfter({ currentFreezes: 2, spent: true, newDayNumber: 14 }),
    ).toBe(2);
  });

  it('spend without earn day decrements by 1', () => {
    expect(
      computeFreezesAfter({ currentFreezes: 2, spent: true, newDayNumber: 8 }),
    ).toBe(1);
  });
});

// ─── Service-level tests ────────────────────────────────────────────

function makePrismaMock(opts: {
  row?: { streak: number; lastClaimAt: Date | null; streakFreezes: number } | null;
  alreadyClaimed?: boolean;
} = {}) {
  const claims: any[] = [];
  let dailyRow = opts.row ?? null;
  return {
    dailyLogin: {
      findUnique: jest.fn(async () => dailyRow),
      upsert: jest.fn(async ({ create, update }: any) => {
        if (!dailyRow) dailyRow = { ...create };
        else dailyRow = { ...dailyRow, ...update };
        return dailyRow;
      }),
    },
    dailyLoginClaim: {
      findUnique: jest.fn(async () =>
        opts.alreadyClaimed
          ? { id: 'c-existing', userId: 'u-1', dayNumber: 1, rewardCoins: 50 }
          : null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const c = {
          id: `c-${claims.length + 1}`,
          createdAt: new Date(),
          ...data,
        };
        claims.push(c);
        return c;
      }),
    },
    $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => fn(this)),
    _claims: () => claims,
    _dailyRow: () => dailyRow,
  } as any;
}

function makeService(opts: Parameters<typeof makePrismaMock>[0] = {}) {
  const prisma = makePrismaMock(opts);
  // Hot-wire $transaction → pass itself as the tx client so the
  // service's tx-scoped calls land on the same mock.
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  const betWallet = {
    credit: jest.fn(async (_args: any) => ({ balance: 1000, duplicate: false })),
  };
  const settings = {
    getJson: jest.fn(async (_k: string, fallback: any) => fallback),
  };
  const notifications = {
    enqueue: jest.fn(async (_args: any) => [] as unknown[]),
  };
  const svc = new DailyLoginService(
    prisma as any,
    betWallet as any,
    settings as any,
    notifications as any,
  );
  return { svc, prisma, betWallet, notifications };
}

describe('DailyLoginService.claim', () => {
  it('first-ever claim → day 1, credits coins, advances row', async () => {
    const { svc, prisma, betWallet } = makeService({ row: null });
    const res = await svc.claim('u-1', TODAY);
    expect(res.dayNumber).toBe(1);
    expect(res.rewardCoins).toBe(50);
    expect(prisma._claims()).toHaveLength(1);
    expect(prisma._claims()[0].claimDateUtc.getTime()).toBe(TODAY_UTC.getTime());
    expect(betWallet.credit).toHaveBeenCalledTimes(1);
    expect(betWallet.credit.mock.calls[0][0].reference).toBe(
      'daily_login:c-1',
    );
    expect(prisma._dailyRow().streak).toBe(1);
  });

  it('409s on a same-day re-claim', async () => {
    const { svc } = makeService({
      row: {
        streak: 1,
        lastClaimAt: TODAY,
        streakFreezes: 0,
      },
      alreadyClaimed: true,
    });
    await expect(svc.claim('u-1', TODAY)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('keeps the claim row even if the wallet credit fails', async () => {
    const { svc, prisma, betWallet } = makeService({ row: null });
    betWallet.credit.mockImplementationOnce(async () => {
      throw new Error('bet host 500');
    });
    await expect(svc.claim('u-1', TODAY)).rejects.toThrow('bet host 500');
    // Claim row persists → retry of the credit is idempotent under
    // the daily_login:<id> reference.
    expect(prisma._claims()).toHaveLength(1);
  });

  it('14-day milestone earns a freeze', async () => {
    const { svc, prisma } = makeService({
      row: {
        streak: 13,
        lastClaimAt: new Date(TODAY.getTime() - 20 * 3_600_000),
        streakFreezes: 0,
      },
    });
    const res = await svc.claim('u-1', TODAY);
    expect(res.dayNumber).toBe(14);
    expect(res.freezesRemaining).toBe(1);
    expect(prisma._dailyRow().streakFreezes).toBe(1);
  });

  it('spending a freeze keeps the streak after a missed day', async () => {
    const { svc } = makeService({
      row: {
        streak: 10,
        lastClaimAt: new Date(TODAY.getTime() - 48 * 3_600_000),
        streakFreezes: 1,
      },
    });
    const res = await svc.claim('u-1', TODAY);
    expect(res.dayNumber).toBe(11);
    expect(res.freezesRemaining).toBe(0);
  });
});

describe('DailyLoginService.getState', () => {
  it('returns claimedToday=true after a claim row exists', async () => {
    const { svc } = makeService({
      row: { streak: 5, lastClaimAt: TODAY, streakFreezes: 0 },
      alreadyClaimed: true,
    });
    const state = await svc.getState('u-1', TODAY);
    expect(state.claimedToday).toBe(true);
    expect(state.nextClaim).toBeNull();
    expect(state.nextClaimAt).not.toBeNull();
  });

  it('returns claimedToday=false with a reward preview otherwise', async () => {
    const { svc } = makeService({
      row: { streak: 5, lastClaimAt: new Date(TODAY.getTime() - 20 * 3_600_000), streakFreezes: 0 },
    });
    const state = await svc.getState('u-1', TODAY);
    expect(state.claimedToday).toBe(false);
    expect(state.nextClaim?.dayNumber).toBe(6);
    expect(state.nextClaim?.freezeWouldBeSpent).toBe(false);
    expect(typeof state.nextClaim?.rewardCoins).toBe('number');
  });
});
