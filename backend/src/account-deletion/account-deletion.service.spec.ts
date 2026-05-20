import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AccountDeletionService } from './account-deletion.service';

/**
 * Account-deletion service tests. Covers:
 *   1. status() — pending / not-pending state shaping.
 *   2. request() — fresh request, conflict on active row, replace
 *      after cancellation, reject after purge.
 *   3. cancel() — clears cancelledAt, refuses after cool-off lapses.
 *   4. purge() — refuses before effectiveAt, idempotent after,
 *      anonymises the User row with the expected scrubbed values.
 *   5. exportData() — bundles every read-side relation.
 */

interface UserRow {
  id: string;
  email: string | null;
  username: string;
  passwordHash: string;
  displayName: string | null;
  avatarKey: string | null;
  legalName: string | null;
  whatsappPhone: string | null;
  betUserId: string | null;
  referralCode: string | null;
  bannedReason: string | null;
  passwordChangedAt: Date | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  isAdmin: boolean;
  bannedAt: Date | null;
  createdAt: Date;
}

interface DeletionRow {
  id: string;
  userId: string;
  reason: string | null;
  requestedAt: Date;
  effectiveAt: Date;
  cancelledAt: Date | null;
  purgedAt: Date | null;
}

function defaultUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 'u-1',
    email: 'a@b.test',
    username: 'alice',
    passwordHash: 'hash',
    displayName: 'Alice',
    avatarKey: null,
    legalName: null,
    whatsappPhone: null,
    betUserId: 'bet-1',
    referralCode: 'ALI-123',
    bannedReason: null,
    passwordChangedAt: null,
    emailVerified: true,
    phoneVerified: false,
    isAdmin: false,
    bannedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makePrismaMock(opts: {
  user?: UserRow | null;
  deletion?: DeletionRow | null;
} = {}) {
  const users = new Map<string, UserRow>();
  if (opts.user) users.set(opts.user.id, { ...opts.user });
  let deletion: DeletionRow | null = opts.deletion ? { ...opts.deletion } : null;

  // Common pattern across all the deleteMany / findMany tables —
  // shared no-op stubs to keep the spec mock surface manageable.
  const emptyMany = jest.fn(async () => []);
  const deleteMany = jest.fn(async () => ({ count: 0 }));

  return {
    user: {
      findUnique: jest.fn(async ({ where }: any) => users.get(where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const u = users.get(where.id);
        if (!u) throw new Error('no row');
        Object.assign(u, data);
        return u;
      }),
    },
    accountDeletion: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (deletion && deletion.userId === where.userId) return deletion;
        return null;
      }),
      upsert: jest.fn(async ({ where, update, create }: any) => {
        if (deletion && deletion.userId === where.userId) {
          deletion = { ...deletion, ...update };
        } else {
          deletion = {
            id: 'del-1',
            userId: where.userId,
            reason: null,
            requestedAt: new Date(),
            effectiveAt: new Date(),
            cancelledAt: null,
            purgedAt: null,
            ...create,
          };
        }
        return deletion;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        if (!deletion || deletion.userId !== where.userId) throw new Error('no row');
        deletion = { ...deletion, ...data };
        return deletion;
      }),
    },
    // Tables that purge() cascades and exportData() reads — all
    // return empty by default (we don't exercise their contents here).
    bid: { findMany: emptyMany },
    notification: { findMany: emptyMany },
    userProfileHistory: { findMany: emptyMany },
    passwordReset: { findMany: emptyMany, deleteMany },
    shippingAddress: { findMany: emptyMany, deleteMany },
    watchlist: { findMany: emptyMany, deleteMany },
    responsibleGamblingProfile: {
      findUnique: jest.fn(async () => null),
    },
    responsibleGamblingEvent: { findMany: emptyMany },
    dailyLoginClaim: { findMany: emptyMany },
    twoFactorAuth: {
      findUnique: jest.fn(async () => null),
      deleteMany,
    },
    trustedDevice: { findMany: emptyMany, deleteMany },
    emailChangeRequest: { deleteMany },
    notificationPreference: { deleteMany },
    deviceToken: { deleteMany },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) =>
      Promise.all(ops),
    ),
    _users: () => users,
    _deletion: () => deletion,
  };
}

function makeNotificationsMock() {
  return { enqueue: jest.fn(async (_args: any) => [] as unknown[]) };
}

function makeService(opts: Parameters<typeof makePrismaMock>[0] = {}) {
  const prisma = makePrismaMock(opts);
  const notifications = makeNotificationsMock();
  return {
    svc: new AccountDeletionService(prisma as any, notifications as any),
    prisma,
    notifications,
  };
}

// ─── status ────────────────────────────────────────────────────────

describe('AccountDeletionService.status', () => {
  it('returns pending:false when no row', async () => {
    const { svc } = makeService({ user: defaultUser() });
    expect(await svc.status('u-1')).toEqual({ pending: false });
  });

  it('returns pending:false when cancelled', async () => {
    const { svc } = makeService({
      user: defaultUser(),
      deletion: {
        id: 'd-1',
        userId: 'u-1',
        reason: null,
        requestedAt: new Date(),
        effectiveAt: new Date(Date.now() + 10 * 86_400_000),
        cancelledAt: new Date(),
        purgedAt: null,
      },
    });
    expect(await svc.status('u-1')).toEqual({ pending: false });
  });

  it('returns pending:true + daysRemaining for active row', async () => {
    const eff = new Date(Date.now() + 10 * 86_400_000);
    const { svc } = makeService({
      user: defaultUser(),
      deletion: {
        id: 'd-1',
        userId: 'u-1',
        reason: 'no longer using',
        requestedAt: new Date(),
        effectiveAt: eff,
        cancelledAt: null,
        purgedAt: null,
      },
    });
    const res = await svc.status('u-1');
    expect(res).toMatchObject({
      pending: true,
      reason: 'no longer using',
      daysRemaining: expect.any(Number),
    });
  });
});

// ─── request ───────────────────────────────────────────────────────

describe('AccountDeletionService.request', () => {
  it('creates a row with effectiveAt ~30 days out', async () => {
    const { svc, prisma } = makeService({ user: defaultUser() });
    const res = await svc.request('u-1', 'moving on');
    const ageMs = new Date(res.effectiveAt).getTime() - Date.now();
    expect(ageMs).toBeGreaterThan(29 * 86_400_000);
    expect(ageMs).toBeLessThanOrEqual(30 * 86_400_000);
    expect(prisma._deletion()!.reason).toBe('moving on');
  });

  it('409s on active pending request', async () => {
    const { svc } = makeService({
      user: defaultUser(),
      deletion: {
        id: 'd-1',
        userId: 'u-1',
        reason: null,
        requestedAt: new Date(),
        effectiveAt: new Date(Date.now() + 10 * 86_400_000),
        cancelledAt: null,
        purgedAt: null,
      },
    });
    await expect(svc.request('u-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows fresh request after cancellation (upsert refreshes window)', async () => {
    const oldEff = new Date(Date.now() + 1 * 86_400_000);
    const { svc, prisma } = makeService({
      user: defaultUser(),
      deletion: {
        id: 'd-1',
        userId: 'u-1',
        reason: null,
        requestedAt: new Date(Date.now() - 5 * 86_400_000),
        effectiveAt: oldEff,
        cancelledAt: new Date(),
        purgedAt: null,
      },
    });
    await svc.request('u-1', 'second thoughts');
    const row = prisma._deletion()!;
    expect(row.cancelledAt).toBeNull();
    expect(row.effectiveAt.getTime()).toBeGreaterThan(oldEff.getTime());
  });

  it('400s if account already purged', async () => {
    const { svc } = makeService({
      user: defaultUser(),
      deletion: {
        id: 'd-1',
        userId: 'u-1',
        reason: null,
        requestedAt: new Date(),
        effectiveAt: new Date(Date.now() - 1_000),
        cancelledAt: null,
        purgedAt: new Date(),
      },
    });
    await expect(svc.request('u-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ─── cancel ────────────────────────────────────────────────────────

describe('AccountDeletionService.cancel', () => {
  it('clears cancelledAt on active row', async () => {
    const { svc, prisma } = makeService({
      user: defaultUser(),
      deletion: {
        id: 'd-1',
        userId: 'u-1',
        reason: null,
        requestedAt: new Date(),
        effectiveAt: new Date(Date.now() + 10 * 86_400_000),
        cancelledAt: null,
        purgedAt: null,
      },
    });
    await svc.cancel('u-1');
    expect(prisma._deletion()!.cancelledAt).toBeInstanceOf(Date);
  });

  it('404s when no active deletion', async () => {
    const { svc } = makeService({ user: defaultUser() });
    await expect(svc.cancel('u-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses cancel after effectiveAt has passed', async () => {
    const { svc } = makeService({
      user: defaultUser(),
      deletion: {
        id: 'd-1',
        userId: 'u-1',
        reason: null,
        requestedAt: new Date(),
        effectiveAt: new Date(Date.now() - 86_400_000),
        cancelledAt: null,
        purgedAt: null,
      },
    });
    await expect(svc.cancel('u-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ─── purge ─────────────────────────────────────────────────────────

describe('AccountDeletionService.purge', () => {
  it('404s when no row', async () => {
    const { svc } = makeService({ user: defaultUser() });
    await expect(svc.purge('u-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses purge before cool-off elapses', async () => {
    const { svc } = makeService({
      user: defaultUser(),
      deletion: {
        id: 'd-1',
        userId: 'u-1',
        reason: null,
        requestedAt: new Date(),
        effectiveAt: new Date(Date.now() + 10 * 86_400_000),
        cancelledAt: null,
        purgedAt: null,
      },
    });
    await expect(svc.purge('u-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses purge if cancelled', async () => {
    const { svc } = makeService({
      user: defaultUser(),
      deletion: {
        id: 'd-1',
        userId: 'u-1',
        reason: null,
        requestedAt: new Date(),
        effectiveAt: new Date(Date.now() - 86_400_000),
        cancelledAt: new Date(),
        purgedAt: null,
      },
    });
    await expect(svc.purge('u-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('happy path scrubs PII and stamps purgedAt', async () => {
    const { svc, prisma } = makeService({
      user: defaultUser(),
      deletion: {
        id: 'd-1',
        userId: 'u-1',
        reason: null,
        requestedAt: new Date(),
        effectiveAt: new Date(Date.now() - 86_400_000),
        cancelledAt: null,
        purgedAt: null,
      },
    });
    await svc.purge('u-1');
    const user = prisma._users().get('u-1')!;
    expect(user.email).toBeNull();
    expect(user.username).toMatch(/^deleted-/);
    expect(user.passwordHash).toBe('<purged>');
    expect(user.displayName).toBeNull();
    expect(user.avatarKey).toBeNull();
    expect(user.legalName).toBeNull();
    expect(user.referralCode).toBeNull();
    expect(user.betUserId).toBeNull();
    expect(user.passwordChangedAt).toBeInstanceOf(Date);
    expect(prisma._deletion()!.purgedAt).toBeInstanceOf(Date);
  });

  it('idempotent — second call no-ops', async () => {
    const { svc } = makeService({
      user: defaultUser(),
      deletion: {
        id: 'd-1',
        userId: 'u-1',
        reason: null,
        requestedAt: new Date(),
        effectiveAt: new Date(Date.now() - 86_400_000),
        cancelledAt: null,
        purgedAt: new Date(),
      },
    });
    await expect(svc.purge('u-1')).resolves.toEqual({ purged: true });
  });
});

// ─── exportData ────────────────────────────────────────────────────

describe('AccountDeletionService.exportData', () => {
  it('returns a bundle including user + every relation array', async () => {
    const { svc } = makeService({ user: defaultUser() });
    const bundle = await svc.exportData('u-1');
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.user.id).toBe('u-1');
    expect(Array.isArray(bundle.bids)).toBe(true);
    expect(Array.isArray(bundle.notifications)).toBe(true);
    expect(Array.isArray(bundle.profileHistory)).toBe(true);
    expect(Array.isArray(bundle.addresses)).toBe(true);
    expect(Array.isArray(bundle.watchlist)).toBe(true);
    expect(Array.isArray(bundle.responsibleGambling.events)).toBe(true);
    expect(Array.isArray(bundle.dailyLoginClaims)).toBe(true);
    expect(Array.isArray(bundle.trustedDevices)).toBe(true);
    expect(typeof bundle.exportedAt).toBe('string');
  });

  it('404s on unknown user', async () => {
    const { svc } = makeService({ user: null });
    await expect(svc.exportData('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
