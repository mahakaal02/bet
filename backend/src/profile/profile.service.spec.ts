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
  // PR-PROFILE-2 fields.
  flagReason?: string | null;
  reviewAction?: 'NONE' | 'PENDING' | 'KEPT_AS_IS' | 'FORCED_RENAME';
  reviewedAt?: Date | null;
  reviewedBy?: string | null;
  reviewNotes?: string | null;
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
          flagReason: data.flagReason ?? null,
          reviewAction: data.reviewAction ?? 'NONE',
          reviewedAt: data.reviewedAt ?? null,
          reviewedBy: data.reviewedBy ?? null,
          reviewNotes: data.reviewNotes ?? null,
        };
        history.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) => history.find((h) => h.id === where.id) ?? null),
      findMany: jest.fn(async ({ where, take, cursor, skip, orderBy, include }: any) => {
        void orderBy; void include;
        let pool = history.slice();
        if (where?.reviewAction) {
          pool = pool.filter((h) => h.reviewAction === where.reviewAction);
        }
        pool.sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime());
        if (cursor) {
          const idx = pool.findIndex((h) => h.id === cursor.id);
          if (idx >= 0) pool = pool.slice(idx + (skip ?? 0));
        }
        const out = pool.slice(0, take);
        return out.map((h) => ({
          ...h,
          user: users.get(h.userId)
            ? {
                id: users.get(h.userId)!.id,
                username: users.get(h.userId)!.username,
                email: users.get(h.userId)!.email,
                displayName: users.get(h.userId)!.displayName,
              }
            : { id: h.userId, username: 'ghost', email: null, displayName: null },
        }));
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const h = history.find((r) => r.id === where.id);
        if (!h) throw new Error(`no history row ${where.id}`);
        Object.assign(h, data);
        return h;
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

// ─── PR-PROFILE-2: moderation queue ────────────────────────────────

describe('ProfileService.setDisplayName flagging', () => {
  it('writes flagReason + reviewAction=PENDING on suspicious names', async () => {
    const { svc, prisma } = makeService({ user: BASE_USER });
    await svc.setDisplayName('u-1', 'Kalki Official');
    const row = prisma._history()[0];
    expect(row.flagReason).toBeTruthy();
    expect(row.reviewAction).toBe('PENDING');
  });

  it('leaves clean names at reviewAction=NONE', async () => {
    const { svc, prisma } = makeService({ user: BASE_USER });
    await svc.setDisplayName('u-1', 'Alice Doe');
    expect(prisma._history()[0].reviewAction).toBe('NONE');
    expect(prisma._history()[0].flagReason).toBeNull();
  });
});

describe('ProfileService.listModerationQueue', () => {
  it('returns only PENDING rows by default', async () => {
    const { svc } = makeService({
      user: BASE_USER,
      history: [
        {
          id: 'h-flag',
          userId: 'u-1',
          field: 'displayName',
          before: 'Alice',
          after: 'Kalki Official',
          changedAt: new Date(),
          flagReason: 'impersonation:brand',
          reviewAction: 'PENDING',
        },
        {
          id: 'h-clean',
          userId: 'u-1',
          field: 'displayName',
          before: null,
          after: 'Alice',
          changedAt: new Date(),
          flagReason: null,
          reviewAction: 'NONE',
        },
      ],
    });
    const res = await svc.listModerationQueue({});
    expect(res.items).toHaveLength(1);
    expect(res.items[0].historyId).toBe('h-flag');
    expect(res.items[0].username).toBe('alice');
  });

  it('honours the action filter', async () => {
    const { svc } = makeService({
      user: BASE_USER,
      history: [
        {
          id: 'h-kept',
          userId: 'u-1',
          field: 'displayName',
          before: null,
          after: 'BorderlineName',
          changedAt: new Date(),
          flagReason: 'public-figure:politician',
          reviewAction: 'KEPT_AS_IS',
        },
      ],
    });
    const res = await svc.listModerationQueue({ action: 'KEPT_AS_IS' });
    expect(res.items.map((i) => i.historyId)).toEqual(['h-kept']);
  });
});

describe('ProfileService.keepAsIs', () => {
  it('flips PENDING → KEPT_AS_IS + records reviewer', async () => {
    const { svc, prisma } = makeService({
      user: BASE_USER,
      history: [
        {
          id: 'h-1',
          userId: 'u-1',
          field: 'displayName',
          before: null,
          after: 'Kalki Sport',
          changedAt: new Date(),
          flagReason: 'impersonation:brand',
          reviewAction: 'PENDING',
        },
      ],
    });
    await svc.keepAsIs({ reviewer: { id: 'admin-1', email: 'admin@kalki.test' }, historyId: 'h-1' });
    const row = prisma._history().find((h) => h.id === 'h-1')!;
    expect(row.reviewAction).toBe('KEPT_AS_IS');
    expect(row.reviewedBy).toBe('admin-1');
  });
});

describe('ProfileService.forceRename', () => {
  it('validates the new name, rejects garbage', async () => {
    const { svc } = makeService({
      user: BASE_USER,
      history: [
        {
          id: 'h-1',
          userId: 'u-1',
          field: 'displayName',
          before: null,
          after: 'Bad Name',
          changedAt: new Date(),
          flagReason: 'impersonation:brand',
          reviewAction: 'PENDING',
        },
      ],
    });
    await expect(
      svc.forceRename({
        reviewer: { id: 'admin-1', email: 'admin@kalki.test' },
        historyId: 'h-1',
        newDisplayName: 'x', // too short → blocked by validation
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('writes the new name, closes the flagged row, leaves audit trail', async () => {
    const { svc, prisma } = makeService({
      user: { ...BASE_USER, displayName: 'Sketchy' },
      history: [
        {
          id: 'h-1',
          userId: 'u-1',
          field: 'displayName',
          before: null,
          after: 'Sketchy',
          changedAt: new Date(),
          flagReason: 'impersonation:brand',
          reviewAction: 'PENDING',
        },
      ],
    });
    const res = await svc.forceRename({
      reviewer: { id: 'admin-1', email: 'admin@kalki.test' },
      historyId: 'h-1',
      newDisplayName: 'New Friendly Name',
      notes: 'too close to brand',
    });
    expect(res.newDisplayName).toBe('New Friendly Name');

    const original = prisma._history().find((h) => h.id === 'h-1')!;
    expect(original.reviewAction).toBe('FORCED_RENAME');
    expect(original.reviewedBy).toBe('admin-1');

    const newest = prisma._history().slice(-1)[0];
    expect(newest.after).toBe('New Friendly Name');
    expect(newest.flagReason).toBe('admin_forced_rename');

    expect(prisma._users.get('u-1')!.displayName).toBe('New Friendly Name');
  });
});

describe('detectSuspiciousDisplayName (re-export)', () => {
  it('catches admin- prefix', () => {
    // Imported inline so we don't add an import block at the top of
    // the file (keeping the existing top imports minimal).
    const { detectSuspiciousDisplayName } = require('./profile-validation');
    expect(detectSuspiciousDisplayName('admin-bot')).toBe('impersonation:admin-prefix');
  });

  it('catches Cyrillic homoglyph in Latin name', () => {
    const { detectSuspiciousDisplayName } = require('./profile-validation');
    // 'аlice' uses Cyrillic а (U+0430) instead of Latin a (U+0061).
    expect(detectSuspiciousDisplayName('аlice')).toMatch(/homoglyph/);
  });

  it('returns undefined for clean names', () => {
    const { detectSuspiciousDisplayName } = require('./profile-validation');
    expect(detectSuspiciousDisplayName('Alice Doe')).toBeUndefined();
  });
});
