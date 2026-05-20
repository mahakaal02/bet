import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ProfileService } from './profile.service';

interface UserRow {
  id: string;
  username: string;
  email: string | null;
  displayName: string | null;
  avatarKey: string | null;
}

interface HistoryRow {
  id: string;
  userId: string;
  field: string;
  before: string | null;
  after: string | null;
  changedAt: Date;
}

function makePrismaMock(opts: {
  user?: UserRow | null;
  history?: HistoryRow[];
  collision?: { id: string } | null;
} = {}) {
  const users = new Map<string, UserRow>();
  // Clone the user so test cases that mutate (update) don't leak
  // state across tests via the shared BASE_USER reference.
  if (opts.user) users.set(opts.user.id, { ...opts.user });
  const history: HistoryRow[] = opts.history
    ? opts.history.map((h) => ({ ...h }))
    : [];
  let nextHistoryId = history.length + 1;

  return {
    user: {
      findUnique: jest.fn(async ({ where }: any) => users.get(where.id) ?? null),
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.displayName?.equals) {
          if (
            opts.collision &&
            opts.collision.id !== where.NOT?.id
          ) {
            return opts.collision;
          }
          return null;
        }
        return null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const u = users.get(where.id);
        if (!u) throw new Error('no row');
        Object.assign(u, data);
        return u;
      }),
    },
    userProfileHistory: {
      findFirst: jest.fn(async ({ where, orderBy }: any) => {
        void orderBy;
        const matching = history.filter(
          (h) => h.userId === where.userId && h.field === where.field,
        );
        if (matching.length === 0) return null;
        // Order desc by changedAt.
        return matching.slice().sort(
          (a, b) => b.changedAt.getTime() - a.changedAt.getTime(),
        )[0];
      }),
      create: jest.fn(async ({ data }: any) => {
        const row: HistoryRow = {
          id: `h-${nextHistoryId++}`,
          userId: data.userId,
          field: data.field,
          before: data.before ?? null,
          after: data.after ?? null,
          changedAt: new Date(),
        };
        history.push(row);
        return row;
      }),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) =>
      Promise.all(ops),
    ),
    _users: users,
    _history: () => history,
  };
}

function makeService(opts: Parameters<typeof makePrismaMock>[0] = {}) {
  const prisma = makePrismaMock(opts);
  return { svc: new ProfileService(prisma as any), prisma };
}

const BASE_USER: UserRow = {
  id: 'u-1',
  username: 'alice',
  email: 'a@b.c',
  displayName: null,
  avatarKey: null,
};

// ─── getProfile ────────────────────────────────────────────────────

describe('ProfileService.getProfile', () => {
  it('returns nulls + null renameAvailableAt for a fresh user', async () => {
    const { svc } = makeService({ user: BASE_USER });
    const p = await svc.getProfile('u-1');
    expect(p.displayName).toBeNull();
    expect(p.avatarKey).toBeNull();
    expect(p.avatarUrl).toBeNull();
    expect(p.renameAvailableAt).toBeNull();
  });

  it('includes avatarUrl when avatarKey is set', async () => {
    const { svc } = makeService({
      user: { ...BASE_USER, avatarKey: 'avatars/u-1/abc.png' },
    });
    const p = await svc.getProfile('u-1');
    expect(p.avatarUrl).toBe('/uploads/avatars/u-1/abc.png');
  });

  it('returns renameAvailableAt 30 days after the last rename', async () => {
    const past = new Date(Date.now() - 5 * 86_400_000);    // 5 days ago
    const { svc } = makeService({
      user: BASE_USER,
      history: [
        {
          id: 'h-1',
          userId: 'u-1',
          field: 'displayName',
          before: null,
          after: 'Alice',
          changedAt: past,
        },
      ],
    });
    const p = await svc.getProfile('u-1');
    expect(p.renameAvailableAt).not.toBeNull();
    const renameAvail = new Date(p.renameAvailableAt!);
    const expected = new Date(past.getTime() + 30 * 86_400_000);
    expect(renameAvail.getTime()).toBe(expected.getTime());
  });

  it('404s on unknown user', async () => {
    const { svc } = makeService({ user: null });
    await expect(svc.getProfile('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

// ─── setDisplayName ────────────────────────────────────────────────

describe('ProfileService.setDisplayName', () => {
  it('400s on invalid name (empty)', async () => {
    const { svc } = makeService({ user: BASE_USER });
    await expect(svc.setDisplayName('u-1', '')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('400s on profanity / reserved', async () => {
    const { svc } = makeService({ user: BASE_USER });
    await expect(
      svc.setDisplayName('u-1', 'admin'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.setDisplayName('u-1', 'fag'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('happy path persists + writes a history row', async () => {
    const { svc, prisma } = makeService({ user: BASE_USER });
    await svc.setDisplayName('u-1', 'Alice');
    expect(prisma._users.get('u-1')!.displayName).toBe('Alice');
    const history = prisma._history();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      userId: 'u-1',
      field: 'displayName',
      before: null,
      after: 'Alice',
    });
  });

  it('trims whitespace before persisting', async () => {
    const { svc, prisma } = makeService({ user: BASE_USER });
    await svc.setDisplayName('u-1', '  Alice  ');
    expect(prisma._users.get('u-1')!.displayName).toBe('Alice');
  });

  it('no-ops when the name is unchanged', async () => {
    const { svc, prisma } = makeService({
      user: { ...BASE_USER, displayName: 'Alice' },
    });
    await svc.setDisplayName('u-1', 'Alice');
    // No history row written.
    expect(prisma._history()).toHaveLength(0);
  });

  it('enforces a 30-day cooldown', async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000);
    const { svc } = makeService({
      user: { ...BASE_USER, displayName: 'Alice' },
      history: [
        {
          id: 'h-1',
          userId: 'u-1',
          field: 'displayName',
          before: null,
          after: 'Alice',
          changedAt: fiveDaysAgo,
        },
      ],
    });
    await expect(svc.setDisplayName('u-1', 'Bob')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('lets the rename through once the cooldown expires', async () => {
    const longAgo = new Date(Date.now() - 31 * 86_400_000);
    const { svc, prisma } = makeService({
      user: { ...BASE_USER, displayName: 'Alice' },
      history: [
        {
          id: 'h-1',
          userId: 'u-1',
          field: 'displayName',
          before: null,
          after: 'Alice',
          changedAt: longAgo,
        },
      ],
    });
    await svc.setDisplayName('u-1', 'Bob');
    expect(prisma._users.get('u-1')!.displayName).toBe('Bob');
  });

  it('409s on a case-insensitive collision', async () => {
    const { svc } = makeService({
      user: BASE_USER,
      collision: { id: 'u-other' },
    });
    await expect(
      svc.setDisplayName('u-1', 'Alice'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

// ─── setAvatarKey ──────────────────────────────────────────────────

describe('ProfileService.setAvatarKey', () => {
  it('rejects keys outside avatars/', async () => {
    const { svc } = makeService({ user: BASE_USER });
    await expect(
      svc.setAvatarKey('u-1', 'not-allowed.png'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.setAvatarKey('u-1', '../etc/passwd.png'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects disallowed extensions', async () => {
    const { svc } = makeService({ user: BASE_USER });
    await expect(
      svc.setAvatarKey('u-1', 'avatars/u-1/abc.exe'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persists + writes history on accept', async () => {
    const { svc, prisma } = makeService({ user: BASE_USER });
    const result = await svc.setAvatarKey('u-1', 'avatars/u-1/abc.png');
    expect(result.avatarUrl).toBe('/uploads/avatars/u-1/abc.png');
    expect(prisma._users.get('u-1')!.avatarKey).toBe('avatars/u-1/abc.png');
    const history = prisma._history();
    expect(history).toHaveLength(1);
    expect(history[0].field).toBe('avatarKey');
  });

  it('no-ops on unchanged key', async () => {
    const { svc, prisma } = makeService({
      user: { ...BASE_USER, avatarKey: 'avatars/u-1/abc.png' },
    });
    await svc.setAvatarKey('u-1', 'avatars/u-1/abc.png');
    expect(prisma._history()).toHaveLength(0);
  });

  it('404s on unknown user', async () => {
    const { svc } = makeService({ user: null });
    await expect(
      svc.setAvatarKey('nope', 'avatars/nope/abc.png'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
