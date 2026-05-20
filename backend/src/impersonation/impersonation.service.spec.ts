import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ImpersonationService } from './impersonation.service';

/**
 * Impersonation service tests. Covers:
 *
 *   1. start(): reason length gate, self-impersonation refusal,
 *      target-is-admin refusal, target-not-found, happy path
 *      (writes ImpersonationLog + AdminAuditLog rows; JWT carries
 *      sub=target, purpose='impersonation', actorId=admin).
 *   2. end(): closes the row, ownership guard, idempotent on
 *      already-closed.
 *   3. list(): cursor pagination, filter by adminId or userId.
 *
 * The JwtService is mocked to return a deterministic string so the
 * test can assert the payload without round-tripping through real
 * JWT crypto.
 */

interface UserRow {
  id: string;
  email: string | null;
  username: string;
  displayName: string | null;
  isAdmin: boolean;
}

interface ImpRow {
  id: string;
  adminId: string;
  userId: string;
  startedAt: Date;
  endedAt: Date | null;
  reason: string;
  admin: { username: string; email: string | null };
  user: { username: string };
}

function makePrismaMock(opts: {
  user?: UserRow | null;
  existing?: ImpRow[];
} = {}) {
  const rows: ImpRow[] = opts.existing ? [...opts.existing] : [];
  let nextId = rows.length + 1;
  return {
    user: {
      findUnique: jest.fn(async () => opts.user ?? null),
    },
    impersonationLog: {
      create: jest.fn(async ({ data }: any) => {
        const row: ImpRow = {
          id: `imp-${nextId++}`,
          adminId: data.adminId,
          userId: data.userId,
          startedAt: new Date(),
          endedAt: null,
          reason: data.reason,
          admin: { username: 'admin', email: 'admin@kalki.test' },
          user: { username: opts.user?.username ?? 'target' },
        };
        rows.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) =>
        rows.find((r) => r.id === where.id) ?? null,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id);
        if (!r) throw new Error('no row');
        Object.assign(r, data);
        return r;
      }),
      findMany: jest.fn(async ({ where, take, cursor, skip, orderBy }: any) => {
        void orderBy;
        let pool = rows.slice();
        if (where?.adminId) pool = pool.filter((r) => r.adminId === where.adminId);
        if (where?.userId) pool = pool.filter((r) => r.userId === where.userId);
        // Order desc by startedAt.
        pool.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
        if (cursor) {
          const idx = pool.findIndex((r) => r.id === cursor.id);
          if (idx >= 0) pool = pool.slice(idx + (skip ?? 0));
        }
        return pool.slice(0, take);
      }),
    },
    _rows: (): ImpRow[] => rows,
  };
}

function makeJwtMock(): {
  sign: jest.Mock;
  _calls: () => unknown[][];
} {
  const sign = jest.fn((_payload: unknown, _opts: unknown) => 'signed-jwt-token');
  return { sign, _calls: () => sign.mock.calls };
}

function makeAuditMock() {
  return { record: jest.fn(async (_args: any) => undefined) };
}

function makeService(opts: Parameters<typeof makePrismaMock>[0] = {}) {
  const prisma = makePrismaMock(opts);
  const jwt = makeJwtMock();
  const audit = makeAuditMock();
  return {
    svc: new ImpersonationService(prisma as any, jwt as any, audit as any),
    prisma,
    jwt,
    audit,
  };
}

const ADMIN = {
  id: 'admin-1',
  email: 'admin@kalki.test',
  username: 'admin',
};

// ─── start ─────────────────────────────────────────────────────────

describe('ImpersonationService.start', () => {
  it('400s on short reason', async () => {
    const { svc } = makeService({
      user: {
        id: 'u-1',
        email: 'a@b.c',
        username: 'alice',
        displayName: null,
        isAdmin: false,
      },
    });
    await expect(
      svc.start({ admin: ADMIN, targetUserId: 'u-1', reason: 'short' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400s on self-impersonation', async () => {
    const { svc } = makeService({
      user: {
        id: 'admin-1',
        email: 'admin@kalki.test',
        username: 'admin',
        displayName: null,
        isAdmin: true,
      },
    });
    await expect(
      svc.start({
        admin: ADMIN,
        targetUserId: 'admin-1',
        reason: 'investigating myself, definitely 10+ chars',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s on missing target', async () => {
    const { svc } = makeService({ user: null });
    await expect(
      svc.start({
        admin: ADMIN,
        targetUserId: 'u-missing',
        reason: 'investigating a stuck withdrawal ticket #1234',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses admin-on-admin impersonation', async () => {
    const { svc } = makeService({
      user: {
        id: 'u-2',
        email: 'ops@kalki.test',
        username: 'ops',
        displayName: null,
        isAdmin: true,
      },
    });
    await expect(
      svc.start({
        admin: ADMIN,
        targetUserId: 'u-2',
        reason: 'investigating ops admin behaviour, ticket #999',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('happy path writes ImpersonationLog + AdminAuditLog + signs token', async () => {
    const { svc, prisma, jwt, audit } = makeService({
      user: {
        id: 'u-1',
        email: 'a@b.c',
        username: 'alice',
        displayName: 'Alice',
        isAdmin: false,
      },
    });
    const res = await svc.start({
      admin: ADMIN,
      targetUserId: 'u-1',
      reason: 'investigating stuck withdrawal ticket #1234',
    });

    // ImpersonationLog row exists.
    expect(prisma._rows()).toHaveLength(1);
    expect(prisma._rows()[0].adminId).toBe('admin-1');
    expect(prisma._rows()[0].userId).toBe('u-1');

    // AdminAuditLog row written with action="impersonation.start".
    expect(audit.record).toHaveBeenCalledTimes(1);
    const auditArgs = audit.record.mock.calls[0][0];
    expect(auditArgs.action).toBe('impersonation.start');
    expect(auditArgs.actorId).toBe('admin-1');

    // JWT signed with the impersonation payload shape.
    expect(jwt._calls()).toHaveLength(1);
    const [payload, signOpts] = jwt._calls()[0] as [Record<string, unknown>, { expiresIn: string }];
    expect(payload).toMatchObject({
      sub: 'u-1',
      username: 'alice',
      purpose: 'impersonation',
      actorId: 'admin-1',
    });
    expect(payload.impersonationId).toBe(prisma._rows()[0].id);
    expect(signOpts.expiresIn).toBe('1h');

    // Response surfaces the target identity + the impersonation id.
    expect(res).toMatchObject({
      token: 'signed-jwt-token',
      expiresIn: '1h',
      impersonationId: prisma._rows()[0].id,
    });
    expect(res.user.id).toBe('u-1');
  });
});

// ─── end ───────────────────────────────────────────────────────────

describe('ImpersonationService.end', () => {
  function rowWith(overrides: Partial<ImpRow> = {}): ImpRow {
    return {
      id: 'imp-1',
      adminId: 'admin-1',
      userId: 'u-1',
      startedAt: new Date(Date.now() - 60_000),
      endedAt: null,
      reason: 'investigating something',
      admin: { username: 'admin', email: 'admin@kalki.test' },
      user: { username: 'alice' },
      ...overrides,
    };
  }

  it('closes the row + writes audit event', async () => {
    const { svc, prisma, audit } = makeService({
      existing: [rowWith()],
    });
    const res = await svc.end('admin-1', 'imp-1');
    expect(prisma._rows()[0].endedAt).toBeInstanceOf(Date);
    expect(typeof res.endedAt).toBe('string');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'impersonation.end',
        actorId: 'admin-1',
      }),
    );
  });

  it('404s on unknown impersonation id', async () => {
    const { svc } = makeService({ existing: [] });
    await expect(svc.end('admin-1', 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('Forbidden when admin tries to end another admin\'s session', async () => {
    const { svc } = makeService({
      existing: [rowWith({ adminId: 'admin-other' })],
    });
    await expect(svc.end('admin-1', 'imp-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('idempotent on already-closed row', async () => {
    const closed = new Date(Date.now() - 1000);
    const { svc } = makeService({
      existing: [rowWith({ endedAt: closed })],
    });
    const res = await svc.end('admin-1', 'imp-1');
    expect(res.endedAt).toBe(closed.toISOString());
  });
});

// ─── list ──────────────────────────────────────────────────────────

describe('ImpersonationService.list', () => {
  function row(overrides: Partial<ImpRow>): ImpRow {
    return {
      id: `imp-${overrides.id ?? 'x'}`,
      adminId: overrides.adminId ?? 'admin-1',
      userId: overrides.userId ?? 'u-1',
      startedAt: overrides.startedAt ?? new Date(),
      endedAt: overrides.endedAt ?? null,
      reason: 'reason',
      admin: { username: 'admin', email: null },
      user: { username: 'user' },
      ...overrides,
    };
  }

  it('filters by adminId', async () => {
    const { svc } = makeService({
      existing: [
        row({ id: 'a' as any, adminId: 'admin-1' }),
        row({ id: 'b' as any, adminId: 'admin-2' }),
      ],
    });
    const res = await svc.list({ adminId: 'admin-1' });
    expect(res.items.map((i) => i.adminId)).toEqual(['admin-1']);
  });

  it('filters by userId', async () => {
    const { svc } = makeService({
      existing: [
        row({ id: 'a' as any, userId: 'u-1' }),
        row({ id: 'b' as any, userId: 'u-2' }),
      ],
    });
    const res = await svc.list({ userId: 'u-2' });
    expect(res.items.map((i) => i.userId)).toEqual(['u-2']);
  });

  it('computes durationMs from startedAt → endedAt (or now if open)', async () => {
    const started = new Date(Date.now() - 60_000);
    const ended = new Date(Date.now() - 10_000);
    const { svc } = makeService({
      existing: [
        row({ id: 'a' as any, startedAt: started, endedAt: ended }),
      ],
    });
    const res = await svc.list({});
    expect(res.items[0].durationMs).toBe(ended.getTime() - started.getTime());
  });
});
