import {
  BadRequestException,
  ConflictException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { EmailChangeService } from './email-change.service';

/**
 * Email-change tests focus on:
 *
 *   1. `request`: re-auth gate, validation, collision detection,
 *      rate limits, both emails sent via direct adapter.
 *   2. `confirm`: per-token-side marking, idempotent re-click,
 *      applies only when BOTH sides confirmed, expired / unknown
 *      / already-applied paths.
 *   3. `cancel`: marks all in-flight requests for the user.
 *
 * Prisma + EmailAdapter + NotificationService are mocked in-memory.
 */

interface MockRequest {
  id: string;
  userId: string;
  oldEmail: string;
  newEmail: string;
  oldTokenHash: string;
  newTokenHash: string;
  oldConfirmedAt: Date | null;
  newConfirmedAt: Date | null;
  expiresAt: Date;
  appliedAt: Date | null;
  createdAt: Date;
}

function makePrismaMock(opts: {
  user?: { id: string; email: string | null; username: string; passwordHash: string } | null;
  collision?: { id: string } | null;
  existing?: MockRequest[];
  perUserCount?: number;
  perIpCount?: number;
} = {}) {
  const requests: MockRequest[] = opts.existing ? [...opts.existing] : [];
  return {
    user: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id) return opts.user ?? null;
        if (where.email) return opts.collision ?? null;
        return null;
      }),
      update: jest.fn(async ({ where, data }: any) => ({
        id: where.id,
        ...data,
      })),
    },
    emailChangeRequest: {
      findFirst: jest.fn(async ({ where, orderBy }: any) => {
        void orderBy;
        return requests.find((r) => matches(r, where)) ?? null;
      }),
      findUnique: jest.fn(async ({ where }: any) =>
        requests.find((r) => r.id === where.id) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const row: MockRequest = {
          id: `req-${requests.length + 1}`,
          userId: data.userId,
          oldEmail: data.oldEmail,
          newEmail: data.newEmail,
          oldTokenHash: data.oldTokenHash,
          newTokenHash: data.newTokenHash,
          oldConfirmedAt: null,
          newConfirmedAt: null,
          expiresAt: data.expiresAt,
          appliedAt: null,
          createdAt: new Date(),
        };
        requests.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = requests.find((r) => r.id === where.id);
        if (!row) throw new Error('no row');
        Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let n = 0;
        for (const r of requests) {
          if (
            r.userId === where.userId &&
            r.appliedAt === null &&
            r.expiresAt.getTime() > Date.now()
          ) {
            Object.assign(r, data);
            n += 1;
          }
        }
        return { count: n };
      }),
      count: jest.fn(async ({ where }: any) => {
        if (where?.userId) return opts.perUserCount ?? 0;
        return opts.perIpCount ?? 0;
      }),
    },
    $transaction: jest.fn(async (ops: any) => {
      if (Array.isArray(ops)) return Promise.all(ops);
      return ops(this);
    }),
    _requests: () => requests,
  };
}

function matches(row: MockRequest, where: any): boolean {
  if (where.userId && row.userId !== where.userId) return false;
  if (where.appliedAt === null && row.appliedAt !== null) return false;
  if (
    where.expiresAt?.gt &&
    row.expiresAt.getTime() <= new Date(where.expiresAt.gt).getTime()
  ) {
    return false;
  }
  if (where.OR) {
    const matchesOR = where.OR.some((o: any) => {
      if (o.oldTokenHash && row.oldTokenHash !== o.oldTokenHash) return false;
      if (o.newTokenHash && row.newTokenHash !== o.newTokenHash) return false;
      return true;
    });
    if (!matchesOR) return false;
  }
  return true;
}

function makeAdapterMock() {
  return {
    sendDirect: jest.fn(async (_args: any) => ({ ok: true as const })),
  };
}

function makeNotificationsMock() {
  return {
    enqueue: jest.fn(async (_args: any) => [] as unknown[]),
  };
}

function makeService(
  opts: Parameters<typeof makePrismaMock>[0] = {},
): {
  svc: EmailChangeService;
  prisma: ReturnType<typeof makePrismaMock>;
  adapter: ReturnType<typeof makeAdapterMock>;
  notifications: ReturnType<typeof makeNotificationsMock>;
} {
  const prisma = makePrismaMock(opts);
  const adapter = makeAdapterMock();
  const notifications = makeNotificationsMock();
  const config = { get: jest.fn(() => undefined) };
  const svc = new EmailChangeService(
    prisma as any,
    adapter as any,
    notifications as any,
    config as any,
  );
  return { svc, prisma, adapter, notifications };
}

function hash(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// ─── request ────────────────────────────────────────────────────────

describe('EmailChangeService.request', () => {
  it('400s on invalid email', async () => {
    const { svc } = makeService({});
    await expect(
      svc.request({
        userId: 'u-1',
        newEmail: 'not-an-email',
        password: 'p',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s on unknown user', async () => {
    const { svc } = makeService({ user: null });
    await expect(
      svc.request({
        userId: 'u-missing',
        newEmail: 'new@kalki.test',
        password: 'p',
      }),
    ).rejects.toBeDefined();
  });

  it('401s on wrong password', async () => {
    const ph = await bcrypt.hash('correct', 10);
    const { svc } = makeService({
      user: {
        id: 'u-1',
        email: 'old@kalki.test',
        username: 'alice',
        passwordHash: ph,
      },
    });
    await expect(
      svc.request({
        userId: 'u-1',
        newEmail: 'new@kalki.test',
        password: 'wrong',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('400s when new email matches current email', async () => {
    const ph = await bcrypt.hash('p', 10);
    const { svc } = makeService({
      user: {
        id: 'u-1',
        email: 'same@kalki.test',
        username: 'alice',
        passwordHash: ph,
      },
    });
    await expect(
      svc.request({
        userId: 'u-1',
        newEmail: 'SAME@kalki.test',
        password: 'p',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('409s when new email is taken by another user', async () => {
    const ph = await bcrypt.hash('p', 10);
    const { svc } = makeService({
      user: {
        id: 'u-1',
        email: 'old@kalki.test',
        username: 'alice',
        passwordHash: ph,
      },
      collision: { id: 'u-2' },
    });
    await expect(
      svc.request({
        userId: 'u-1',
        newEmail: 'taken@kalki.test',
        password: 'p',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('happy path stores hashes + sends two direct emails', async () => {
    const ph = await bcrypt.hash('p', 10);
    const { svc, prisma, adapter } = makeService({
      user: {
        id: 'u-1',
        email: 'old@kalki.test',
        username: 'alice',
        passwordHash: ph,
      },
    });
    await svc.request({
      userId: 'u-1',
      newEmail: 'new@kalki.test',
      password: 'p',
    });
    const row = prisma._requests()[0];
    expect(row.userId).toBe('u-1');
    expect(row.oldEmail).toBe('old@kalki.test');
    expect(row.newEmail).toBe('new@kalki.test');
    // Hashes stored — plaintext nowhere on disk.
    expect(row.oldTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.newTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.oldTokenHash).not.toBe(row.newTokenHash);
    expect(adapter.sendDirect).toHaveBeenCalledTimes(2);
    const recipients = adapter.sendDirect.mock.calls.map(
      (c: any[]) => c[0].toEmail,
    );
    expect(recipients.sort()).toEqual(['new@kalki.test', 'old@kalki.test']);
  });

  it('429s when per-user rate-limit reached', async () => {
    const ph = await bcrypt.hash('p', 10);
    const { svc } = makeService({
      user: {
        id: 'u-1',
        email: 'old@kalki.test',
        username: 'alice',
        passwordHash: ph,
      },
      perUserCount: 2,
    });
    await expect(
      svc.request({
        userId: 'u-1',
        newEmail: 'new@kalki.test',
        password: 'p',
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('cancels any in-flight request before creating a new one', async () => {
    const ph = await bcrypt.hash('p', 10);
    const existing: MockRequest = {
      id: 'req-existing',
      userId: 'u-1',
      oldEmail: 'old@kalki.test',
      newEmail: 'a-typo@kalki.test',
      oldTokenHash: hash('a'),
      newTokenHash: hash('b'),
      oldConfirmedAt: null,
      newConfirmedAt: null,
      expiresAt: new Date(Date.now() + 1_000_000),
      appliedAt: null,
      createdAt: new Date(),
    };
    const { svc, prisma } = makeService({
      user: {
        id: 'u-1',
        email: 'old@kalki.test',
        username: 'alice',
        passwordHash: ph,
      },
      existing: [existing],
    });
    await svc.request({
      userId: 'u-1',
      newEmail: 'new@kalki.test',
      password: 'p',
    });
    // Old row's expiresAt got pulled back to now-ish.
    const updated = prisma
      ._requests()
      .find((r: MockRequest) => r.id === 'req-existing')!;
    expect(updated.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 50);
  });
});

// ─── confirm ────────────────────────────────────────────────────────

describe('EmailChangeService.confirm', () => {
  const oldPlain = 'a'.repeat(64);
  const newPlain = 'b'.repeat(64);

  function makeRow(overrides: Partial<MockRequest> = {}): MockRequest {
    return {
      id: 'req-1',
      userId: 'u-1',
      oldEmail: 'old@kalki.test',
      newEmail: 'new@kalki.test',
      oldTokenHash: hash(oldPlain),
      newTokenHash: hash(newPlain),
      oldConfirmedAt: null,
      newConfirmedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      appliedAt: null,
      createdAt: new Date(),
      ...overrides,
    };
  }

  it('400s on unknown token', async () => {
    const { svc } = makeService({ existing: [] });
    await expect(svc.confirm('unknown')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('400s on expired link', async () => {
    const { svc } = makeService({
      existing: [makeRow({ expiresAt: new Date(Date.now() - 1) })],
    });
    await expect(svc.confirm(oldPlain)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('first click of old token → side=old, applied=false', async () => {
    const { svc, prisma } = makeService({ existing: [makeRow()] });
    const res = await svc.confirm(oldPlain);
    expect(res).toEqual({ side: 'old', applied: false });
    expect(prisma._requests()[0].oldConfirmedAt).not.toBeNull();
    expect(prisma._requests()[0].newConfirmedAt).toBeNull();
    expect(prisma._requests()[0].appliedAt).toBeNull();
  });

  it('second click (new token) flips applied + updates user email', async () => {
    const { svc, prisma } = makeService({
      existing: [makeRow({ oldConfirmedAt: new Date() })],
    });
    const res = await svc.confirm(newPlain);
    expect(res).toEqual({ side: 'new', applied: true });
    expect(prisma._requests()[0].appliedAt).not.toBeNull();
    // user.update called with the new email.
    const userUpdates = prisma.user.update.mock.calls.filter(
      (c: any) => c[0]?.data?.email === 'new@kalki.test',
    );
    expect(userUpdates.length).toBe(1);
  });

  it('re-clicking an already-applied link is idempotent', async () => {
    const { svc } = makeService({
      existing: [
        makeRow({
          oldConfirmedAt: new Date(),
          newConfirmedAt: new Date(),
          appliedAt: new Date(),
        }),
      ],
    });
    const res = await svc.confirm(oldPlain);
    expect(res).toEqual({ side: 'old', applied: true });
  });

  it('enqueues email_change_applied_v1 on apply', async () => {
    const { svc, notifications } = makeService({
      existing: [makeRow({ oldConfirmedAt: new Date() })],
    });
    await svc.confirm(newPlain);
    // The enqueue is fire-and-forget (void chained), so we wait a
    // tick to let the microtask settle before asserting.
    await new Promise((r) => setImmediate(r));
    expect(notifications.enqueue).toHaveBeenCalledTimes(1);
    expect(notifications.enqueue.mock.calls[0][0].templateCode).toBe(
      'email_change_applied_v1',
    );
  });
});

// ─── cancel ─────────────────────────────────────────────────────────

describe('EmailChangeService.cancel', () => {
  it('cancels every in-flight request for the user', async () => {
    const { svc, prisma } = makeService({
      existing: [
        {
          id: 'a',
          userId: 'u-1',
          oldEmail: 'old@kalki.test',
          newEmail: 'new@kalki.test',
          oldTokenHash: hash('x'),
          newTokenHash: hash('y'),
          oldConfirmedAt: null,
          newConfirmedAt: null,
          expiresAt: new Date(Date.now() + 1_000_000),
          appliedAt: null,
          createdAt: new Date(),
        },
      ],
    });
    const res = await svc.cancel('u-1');
    expect(res.cancelled).toBe(1);
    expect(prisma._requests()[0].expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 50,
    );
  });
});
