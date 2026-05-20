import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  TicketCategory,
  TicketCloseReason,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';
import { TicketsService } from './tickets.service';

/**
 * Tests cover:
 *   - submit: length gates, duplicate-active refusal per category,
 *     SLA timer set from priority, initial message inserted, idempotent
 *     by anti-duplicate.
 *   - listMine / getMine: ownership guard, internal notes hidden.
 *   - userReply: bumps to AWAITING_ADMIN, refused on CLOSED.
 *   - adminReply: public stamps firstResponseAt + flips to AWAITING_USER;
 *     internal note doesn't change status; audit row.
 *   - assign / escalate / close: state + audit.
 */

interface TicketRow {
  id: string;
  userId: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: TicketCategory;
  slaDueAt: Date;
  firstResponseAt: Date | null;
  linkedEntityType: string | null;
  linkedEntityId: string | null;
  assignedToId: string | null;
  closedAt: Date | null;
  closedReason: TicketCloseReason | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MsgRow {
  id: string;
  ticketId: string;
  senderId: string;
  isFromAdmin: boolean;
  isInternal: boolean;
  body: string;
  createdAt: Date;
}

function makeMocks(opts: {
  tickets?: TicketRow[];
  users?: Array<{ id: string; username: string; email: string | null }>;
  settings?: Record<string, number>;
} = {}) {
  const tickets = (opts.tickets ?? []).map((t) => ({ ...t }));
  const messages: MsgRow[] = [];
  const users = new Map((opts.users ?? []).map((u) => [u.id, u]));

  const prisma: any = {
    supportTicket: {
      findUnique: jest.fn(async ({ where }: any) => tickets.find((t) => t.id === where.id) ?? null),
      findFirst: jest.fn(async ({ where }: any) =>
        tickets.find((t) => {
          if (where.userId && t.userId !== where.userId) return false;
          if (where.category && t.category !== where.category) return false;
          if (where.status?.in && !where.status.in.includes(t.status)) return false;
          return true;
        }) ?? null,
      ),
      findMany: jest.fn(async ({ where, take, cursor, skip, orderBy, include }: any) => {
        void orderBy;
        let pool = tickets.slice();
        if (where?.userId) pool = pool.filter((t) => t.userId === where.userId);
        if (where?.status) pool = pool.filter((t) => t.status === where.status);
        if (where?.category) pool = pool.filter((t) => t.category === where.category);
        if (where?.assignedToId) pool = pool.filter((t) => t.assignedToId === where.assignedToId);
        pool.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        if (cursor) {
          const idx = pool.findIndex((t) => t.id === cursor.id);
          if (idx >= 0) pool = pool.slice(idx + (skip ?? 0));
        }
        const out = pool.slice(0, take);
        if (include?.user) {
          return out.map((t) => ({ ...t, user: users.get(t.userId) ?? { id: t.userId, username: 'unknown', email: null } }));
        }
        return out;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row: TicketRow = {
          id: `t-${tickets.length + 1}`,
          userId: data.userId,
          subject: data.subject,
          status: data.status,
          priority: data.priority,
          category: data.category,
          slaDueAt: data.slaDueAt,
          firstResponseAt: null,
          linkedEntityType: data.linkedEntityType ?? null,
          linkedEntityId: data.linkedEntityId ?? null,
          assignedToId: null,
          closedAt: null,
          closedReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        tickets.push(row);
        if (data.messages?.create) {
          messages.push({
            id: `m-${messages.length + 1}`,
            ticketId: row.id,
            senderId: data.messages.create.senderId,
            isFromAdmin: data.messages.create.isFromAdmin,
            isInternal: data.messages.create.isInternal,
            body: data.messages.create.body,
            createdAt: new Date(),
          });
        }
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const t = tickets.find((r) => r.id === where.id);
        if (!t) throw new Error('no ticket');
        Object.assign(t, data, { updatedAt: new Date() });
        return t;
      }),
    },
    supportMessage: {
      create: jest.fn(async ({ data }: any) => {
        const row: MsgRow = {
          id: `m-${messages.length + 1}`,
          ticketId: data.ticketId,
          senderId: data.senderId,
          isFromAdmin: data.isFromAdmin,
          isInternal: data.isInternal ?? false,
          body: data.body,
          createdAt: new Date(),
        };
        messages.push(row);
        return row;
      }),
      findMany: jest.fn(async ({ where, orderBy }: any) => {
        void orderBy;
        let pool = messages.slice();
        if (where?.ticketId) pool = pool.filter((m) => m.ticketId === where.ticketId);
        if (where?.isInternal !== undefined) pool = pool.filter((m) => m.isInternal === where.isInternal);
        return pool.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      }),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };

  const audit = { record: jest.fn(async () => undefined) };
  const settings = {
    getInt: jest.fn(async (key: string, fallback: number) => opts.settings?.[key] ?? fallback),
  };
  const svc = new TicketsService(prisma, audit as any, settings as any);
  return { svc, prisma, audit, _tickets: () => tickets, _messages: () => messages };
}

const BASE_TICKET = (overrides: Partial<TicketRow> = {}): TicketRow => ({
  id: 't-1',
  userId: 'u-1',
  subject: 'help',
  status: TicketStatus.OPEN,
  priority: TicketPriority.NORMAL,
  category: TicketCategory.ACCOUNT,
  slaDueAt: new Date(Date.now() + 3600_000),
  firstResponseAt: null,
  linkedEntityType: null,
  linkedEntityId: null,
  assignedToId: null,
  closedAt: null,
  closedReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const ADMIN = { id: 'admin-1', email: 'admin@kalki.test' };

describe('TicketsService.submit', () => {
  it('rejects too-short subject or body', async () => {
    const { svc } = makeMocks();
    await expect(
      svc.submit({ userId: 'u-1', subject: 'hi', body: 'this is long enough', category: TicketCategory.ACCOUNT }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.submit({ userId: 'u-1', subject: 'long enough', body: 'short', category: TicketCategory.ACCOUNT }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses second active ticket in same category', async () => {
    const { svc } = makeMocks({
      tickets: [BASE_TICKET({ status: TicketStatus.AWAITING_ADMIN })],
    });
    await expect(
      svc.submit({
        userId: 'u-1',
        subject: 'still need help',
        body: 'detailed description here',
        category: TicketCategory.ACCOUNT,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows new ticket in DIFFERENT category', async () => {
    const { svc, _tickets } = makeMocks({
      tickets: [BASE_TICKET({ status: TicketStatus.AWAITING_ADMIN })],
    });
    await svc.submit({
      userId: 'u-1',
      subject: 'different issue',
      body: 'this one is about deposits',
      category: TicketCategory.DEPOSIT,
    });
    expect(_tickets()).toHaveLength(2);
  });

  it('sets SLA timer per priority', async () => {
    const { svc } = makeMocks();
    const before = Date.now();
    const res = await svc.submit({
      userId: 'u-1',
      subject: 'urgent help',
      body: 'this is broken now please',
      category: TicketCategory.WITHDRAWAL,
      priority: TicketPriority.URGENT,
    });
    const diff = res.slaDueAt.getTime() - before;
    expect(diff).toBeGreaterThan(59 * 60_000);  // URGENT = 60min
    expect(diff).toBeLessThanOrEqual(61 * 60_000);
  });

  it('inserts the initial message', async () => {
    const { svc, _messages } = makeMocks();
    await svc.submit({
      userId: 'u-1',
      subject: 'help me',
      body: 'long enough body here',
      category: TicketCategory.OTHER,
    });
    expect(_messages()).toHaveLength(1);
    expect(_messages()[0].isFromAdmin).toBe(false);
    expect(_messages()[0].isInternal).toBe(false);
  });
});

describe('TicketsService.userReply / getMine', () => {
  it('user reply bounces to AWAITING_ADMIN', async () => {
    const { svc, _tickets } = makeMocks({
      tickets: [BASE_TICKET({ status: TicketStatus.AWAITING_USER })],
    });
    const r = await svc.userReply({ userId: 'u-1', ticketId: 't-1', body: 'still broken' });
    expect(r.status).toBe(TicketStatus.AWAITING_ADMIN);
    expect(_tickets()[0].status).toBe(TicketStatus.AWAITING_ADMIN);
  });

  it('refuses reply on CLOSED tickets', async () => {
    const { svc } = makeMocks({
      tickets: [BASE_TICKET({ status: TicketStatus.CLOSED })],
    });
    await expect(
      svc.userReply({ userId: 'u-1', ticketId: 't-1', body: 'reopen this' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('forbids reply on someone else\'s ticket', async () => {
    const { svc } = makeMocks({ tickets: [BASE_TICKET()] });
    await expect(
      svc.userReply({ userId: 'spoof', ticketId: 't-1', body: 'mine now' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('getMine hides internal notes', async () => {
    const { svc, prisma, _messages } = makeMocks({ tickets: [BASE_TICKET()] });
    _messages().push({
      id: 'm-1', ticketId: 't-1', senderId: 'admin-1',
      isFromAdmin: true, isInternal: true, body: 'internal note', createdAt: new Date(),
    });
    _messages().push({
      id: 'm-2', ticketId: 't-1', senderId: 'admin-1',
      isFromAdmin: true, isInternal: false, body: 'public reply', createdAt: new Date(),
    });
    const r = await svc.getMine('u-1', 't-1');
    expect(r.messages.map((m: any) => m.body)).toEqual(['public reply']);
    void prisma;
  });
});

describe('TicketsService.adminReply', () => {
  it('public reply stamps firstResponseAt + flips to AWAITING_USER', async () => {
    const { svc, _tickets, audit } = makeMocks({ tickets: [BASE_TICKET()] });
    await svc.adminReply({
      adminId: ADMIN.id, adminEmail: ADMIN.email,
      ticketId: 't-1', body: 'we are looking into it',
    });
    expect(_tickets()[0].status).toBe(TicketStatus.AWAITING_USER);
    expect(_tickets()[0].firstResponseAt).toBeInstanceOf(Date);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'support.admin_reply' }),
    );
  });

  it('internal note does NOT change status or firstResponseAt', async () => {
    const { svc, _tickets, audit } = makeMocks({ tickets: [BASE_TICKET()] });
    await svc.adminReply({
      adminId: ADMIN.id, adminEmail: ADMIN.email,
      ticketId: 't-1', body: 'fyi, talked to finance', isInternal: true,
    });
    expect(_tickets()[0].status).toBe(TicketStatus.OPEN);
    expect(_tickets()[0].firstResponseAt).toBeNull();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'support.admin_note' }),
    );
  });

  it('does not bump firstResponseAt on subsequent public replies', async () => {
    const initialResponse = new Date(Date.now() - 60_000);
    const { svc, _tickets } = makeMocks({
      tickets: [BASE_TICKET({ status: TicketStatus.AWAITING_ADMIN, firstResponseAt: initialResponse })],
    });
    await svc.adminReply({
      adminId: ADMIN.id, adminEmail: ADMIN.email,
      ticketId: 't-1', body: 'follow-up',
    });
    expect(_tickets()[0].firstResponseAt!.getTime()).toBe(initialResponse.getTime());
  });
});

describe('TicketsService.assign / escalate / close', () => {
  it('assign updates + audits before/after', async () => {
    const { svc, _tickets, audit } = makeMocks({ tickets: [BASE_TICKET()] });
    await svc.assign({ adminId: ADMIN.id, adminEmail: ADMIN.email, ticketId: 't-1', assigneeId: 'admin-2' });
    expect(_tickets()[0].assignedToId).toBe('admin-2');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'support.assign',
        before: { assignedToId: null },
        after: { assignedToId: 'admin-2' },
      }),
    );
  });

  it('escalate requires reason + flips status + bumps priority', async () => {
    const { svc, _tickets } = makeMocks({
      tickets: [BASE_TICKET({ priority: TicketPriority.NORMAL })],
    });
    await svc.escalate({
      adminId: ADMIN.id, adminEmail: ADMIN.email,
      ticketId: 't-1', reason: 'finance involvement needed',
    });
    expect(_tickets()[0].status).toBe(TicketStatus.ESCALATED);
    expect(_tickets()[0].priority).toBe(TicketPriority.HIGH);
  });

  it('escalate rejects short reason', async () => {
    const { svc } = makeMocks({ tickets: [BASE_TICKET()] });
    await expect(
      svc.escalate({ adminId: ADMIN.id, adminEmail: ADMIN.email, ticketId: 't-1', reason: 'no' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('close idempotent on already-CLOSED', async () => {
    const { svc, _tickets } = makeMocks({
      tickets: [BASE_TICKET({ status: TicketStatus.CLOSED, closedAt: new Date(), closedReason: TicketCloseReason.RESOLVED })],
    });
    const r = await svc.close({ adminId: ADMIN.id, adminEmail: ADMIN.email, ticketId: 't-1', reason: TicketCloseReason.RESOLVED });
    expect(r.status).toBe(TicketStatus.CLOSED);
    expect(_tickets()[0].closedAt).toBeInstanceOf(Date);
  });

  it('404 on unknown ticket', async () => {
    const { svc } = makeMocks();
    await expect(
      svc.close({ adminId: ADMIN.id, adminEmail: ADMIN.email, ticketId: 'nope', reason: TicketCloseReason.RESOLVED }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
