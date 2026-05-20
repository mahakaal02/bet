import { BadRequestException, HttpException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PasswordResetService } from './password-reset.service';

/**
 * Password-reset service tests. Covers:
 *
 *   1. `request()`: account-enumeration resistance (never throws when
 *      the email is unknown), token-hash storage, notification enqueue.
 *   2. `confirm()`: token verification (hash match, not-used, not-
 *      expired), password length rules, atomic password rotation,
 *      `passwordChangedAt` bump.
 *   3. Rate limits: 3/email/hour, 5/IP/hour.
 *   4. Pure `hash()` helper.
 *
 * We use a thin Prisma mock that records calls and an in-memory map
 * for `passwordReset` rows so the test can verify the round-trip
 * (hash on write, hash lookup on read).
 */

interface PwResetRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  requestedIp: string | null;
  createdAt: Date;
  user: { id: string; email: string; username: string } | null;
}

function makePrismaMock(opts: {
  user?: { id: string; email: string; username: string } | null;
  existingRow?: Partial<PwResetRow> | null;
  perEmailCount?: number;
  perIpCount?: number;
} = {}) {
  const rows = new Map<string, PwResetRow>();
  if (opts.existingRow) {
    const id = opts.existingRow.id ?? 'row-1';
    rows.set(opts.existingRow.tokenHash!, {
      id,
      userId: opts.existingRow.userId ?? 'u-1',
      tokenHash: opts.existingRow.tokenHash!,
      expiresAt: opts.existingRow.expiresAt ?? new Date(Date.now() + 60_000),
      usedAt: opts.existingRow.usedAt ?? null,
      requestedIp: opts.existingRow.requestedIp ?? null,
      createdAt: opts.existingRow.createdAt ?? new Date(),
      user:
        opts.existingRow.user ??
        opts.user ??
        null,
    });
  }
  const userUpdate = jest.fn(async (_args: any) => ({ id: 'u-1' }) as any);
  return {
    user: {
      findUnique: jest.fn(async () => opts.user ?? null),
      update: userUpdate,
    },
    passwordReset: {
      create: jest.fn(async ({ data }: any) => {
        const row: PwResetRow = {
          id: `row-${rows.size + 1}`,
          userId: data.userId,
          tokenHash: data.tokenHash,
          expiresAt: data.expiresAt,
          usedAt: null,
          requestedIp: data.requestedIp ?? null,
          createdAt: new Date(),
          user: opts.user ?? null,
        };
        rows.set(data.tokenHash, row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) => rows.get(where.tokenHash) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        for (const r of rows.values()) {
          if (r.id === where.id) {
            r.usedAt = data.usedAt ?? r.usedAt;
            return r;
          }
        }
        throw new Error(`no row id=${where.id}`);
      }),
      count: jest.fn(async ({ where }: any) => {
        if (where?.user?.email) return opts.perEmailCount ?? 0;
        if (where?.requestedIp) return opts.perIpCount ?? 0;
        return 0;
      }),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    _userUpdate: userUpdate,
    _rows: rows,
  };
}

function makeNotificationsMock() {
  const enqueue = jest.fn(async (_args: any) => [] as unknown[]);
  return { enqueue, _calls: () => enqueue.mock.calls };
}

function makeConfigMock(overrides: Record<string, string> = {}) {
  return {
    get: jest.fn((k: string) => overrides[k]),
  };
}

function makeService(opts: Parameters<typeof makePrismaMock>[0] = {}) {
  const prisma = makePrismaMock(opts);
  const notifications = makeNotificationsMock();
  const config = makeConfigMock();
  // PR-2FA-2 added a cross-revoke call on successful password reset.
  // A no-op stub keeps the tests focused on the password-reset path.
  const trustedDevice = {
    revokeAll: jest.fn(async (_userId: string) => ({ revoked: 0 })),
  };
  const svc = new PasswordResetService(
    prisma as any,
    notifications as any,
    config as any,
    trustedDevice as any,
  );
  return { svc, prisma, notifications, config, trustedDevice };
}

describe('PasswordResetService.request', () => {
  it('silently no-ops when the email is unknown (no enumeration)', async () => {
    const { svc, prisma, notifications } = makeService({ user: null });
    await expect(svc.request({ email: 'who@nowhere.test' })).resolves.toBeUndefined();
    expect(prisma.passwordReset.create).not.toHaveBeenCalled();
    expect(notifications.enqueue).not.toHaveBeenCalled();
  });

  it('lowercases + trims the incoming email before lookup', async () => {
    const { svc, prisma } = makeService({ user: null });
    await svc.request({ email: '  Mixed@Case.IO  ' });
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'mixed@case.io' } }),
    );
  });

  it('on a hit stores only the token HASH (never plaintext)', async () => {
    const user = { id: 'u-1', email: 'a@b.com', username: 'alice' };
    const { svc, prisma } = makeService({ user });
    await svc.request({ email: 'a@b.com' });
    expect(prisma.passwordReset.create).toHaveBeenCalledTimes(1);
    const stored = prisma.passwordReset.create.mock.calls[0][0].data;
    // sha256 → 64 hex chars.
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.userId).toBe('u-1');
  });

  it('enqueues an EMAIL-only notification (no push leakage)', async () => {
    const user = { id: 'u-1', email: 'a@b.com', username: 'alice' };
    const { svc, notifications } = makeService({ user });
    await svc.request({ email: 'a@b.com' });
    expect(notifications.enqueue).toHaveBeenCalledTimes(1);
    const args = notifications.enqueue.mock.calls[0][0];
    expect(args.templateCode).toBe('password_reset_v1');
    expect(args.channels).toEqual(['EMAIL']);
    expect(args.payload).toMatchObject({ username: 'alice' });
    expect(args.payload.resetUrl).toContain('/auth/reset?token=');
  });

  it('throws 429 when per-email cap is hit (no row written, no email sent)', async () => {
    const user = { id: 'u-1', email: 'a@b.com', username: 'alice' };
    const { svc, prisma, notifications } = makeService({
      user,
      perEmailCount: 3,
    });
    await expect(svc.request({ email: 'a@b.com' })).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(prisma.passwordReset.create).not.toHaveBeenCalled();
    expect(notifications.enqueue).not.toHaveBeenCalled();
  });

  it('throws 429 when per-IP cap is hit', async () => {
    const user = { id: 'u-1', email: 'a@b.com', username: 'alice' };
    const { svc } = makeService({ user, perIpCount: 5 });
    await expect(
      svc.request({ email: 'a@b.com', ip: '1.2.3.4' }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});

describe('PasswordResetService.confirm', () => {
  const plain = 'a'.repeat(64);                  // 32-byte hex
  const tokenHash = PasswordResetService.hash(plain);

  function existingRow(overrides: Partial<PwResetRow> = {}) {
    return {
      id: 'row-1',
      userId: 'u-1',
      tokenHash,
      expiresAt: new Date(Date.now() + 30 * 60_000),
      usedAt: null,
      requestedIp: null,
      createdAt: new Date(),
      user: { id: 'u-1', email: 'a@b.com', username: 'alice' },
      ...overrides,
    };
  }

  it('400s when the password is shorter than 8 chars', async () => {
    const { svc } = makeService({ existingRow: existingRow() });
    await expect(
      svc.confirm({ token: plain, newPassword: 'short' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400s on an unknown token', async () => {
    const { svc } = makeService({});                     // no existingRow
    await expect(
      svc.confirm({ token: 'bogus', newPassword: 'longenough' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400s on an expired token', async () => {
    const { svc } = makeService({
      existingRow: existingRow({ expiresAt: new Date(Date.now() - 1_000) }),
    });
    await expect(
      svc.confirm({ token: plain, newPassword: 'longenough' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400s on a token that was already used', async () => {
    const { svc } = makeService({
      existingRow: existingRow({ usedAt: new Date() }),
    });
    await expect(
      svc.confirm({ token: plain, newPassword: 'longenough' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('happy path: rotates password, bumps passwordChangedAt, marks usedAt, enqueues notification', async () => {
    const { svc, prisma, notifications } = makeService({
      existingRow: existingRow(),
    });
    await svc.confirm({ token: plain, newPassword: 'longenough123' });

    // Password rotated + passwordChangedAt set.
    const userUpd = prisma._userUpdate.mock.calls[0][0];
    expect(userUpd.where).toEqual({ id: 'u-1' });
    expect(typeof userUpd.data.passwordHash).toBe('string');
    expect(userUpd.data.passwordHash.length).toBeGreaterThan(20);
    expect(userUpd.data.passwordChangedAt).toBeInstanceOf(Date);
    // bcrypt verify matches the supplied plaintext.
    expect(
      await bcrypt.compare('longenough123', userUpd.data.passwordHash),
    ).toBe(true);

    // Reset row marked usedAt.
    const row = prisma._rows.get(tokenHash);
    expect(row?.usedAt).toBeInstanceOf(Date);

    // Inform-on-use notification.
    expect(notifications.enqueue).toHaveBeenCalledTimes(1);
    const args = notifications.enqueue.mock.calls[0][0];
    expect(args.templateCode).toBe('password_changed_v1');
    expect(new Set(args.channels)).toEqual(
      new Set(['EMAIL', 'PUSH', 'INAPP']),
    );
  });
});

describe('PasswordResetService.hash', () => {
  it('is deterministic + sha256-shaped', () => {
    const a = PasswordResetService.hash('abc');
    const b = PasswordResetService.hash('abc');
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('differs for distinct inputs', () => {
    expect(PasswordResetService.hash('a')).not.toBe(
      PasswordResetService.hash('b'),
    );
  });
});
