import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReconciliationStatus } from '@prisma/client';
import { BalanceFetcher, ReconciliationService } from './reconciliation.service';

interface ReportRow {
  id: string;
  forDate: Date;
  status: ReconciliationStatus;
  startedAt: Date;
  completedAt: Date | null;
  failureReason: string | null;
  usersChecked: number;
  usersOk: number;
  usersDiscrepant: number;
  totalAbsDrift: number;
  createdAt: Date;
}

interface DiscRow {
  id: string;
  reportId: string;
  userId: string;
  localSum: number;
  remoteSum: number;
  drift: number;
  notes: string | null;
  acknowledged: boolean;
  ackedBy: string | null;
  ackedAt: Date | null;
  createdAt: Date;
}

function makeMocks(opts: {
  txByUser?: Record<string, number>; // userId -> sum
  recentUsers?: string[];
  balances?: Record<string, number>;
  balanceErrors?: Record<string, string>;
  reports?: ReportRow[];
  discrepancies?: DiscRow[];
} = {}) {
  const reports = (opts.reports ?? []).map((r) => ({ ...r }));
  const discrepancies = (opts.discrepancies ?? []).map((d) => ({ ...d }));
  const txByUser = opts.txByUser ?? {};
  const recentUsers = opts.recentUsers ?? Object.keys(txByUser);

  const prisma: any = {
    reconciliationReport: {
      findUnique: jest.fn(async ({ where }: any) =>
        reports.find((r) => (where.forDate ? r.forDate.getTime() === where.forDate.getTime() : r.id === where.id)) ?? null,
      ),
      findMany: jest.fn(async ({ take, cursor, skip, orderBy }: any) => {
        void orderBy;
        let pool = reports.slice().sort((a, b) => b.forDate.getTime() - a.forDate.getTime());
        if (cursor) {
          const idx = pool.findIndex((r) => r.id === cursor.id);
          if (idx >= 0) pool = pool.slice(idx + (skip ?? 0));
        }
        return pool.slice(0, take);
      }),
      create: jest.fn(async ({ data }: any) => {
        const row: ReportRow = {
          id: `r-${reports.length + 1}`,
          forDate: data.forDate,
          status: data.status,
          startedAt: new Date(),
          completedAt: null,
          failureReason: null,
          usersChecked: 0,
          usersOk: 0,
          usersDiscrepant: 0,
          totalAbsDrift: 0,
          createdAt: new Date(),
        };
        reports.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const r = reports.find((x) => x.id === where.id);
        if (!r) throw new Error('no report');
        Object.assign(r, data);
        return r;
      }),
    },
    reconciliationDiscrepancy: {
      create: jest.fn(async ({ data }: any) => {
        const row: DiscRow = {
          id: `d-${discrepancies.length + 1}`,
          reportId: data.reportId,
          userId: data.userId,
          localSum: data.localSum,
          remoteSum: data.remoteSum,
          drift: data.drift,
          notes: data.notes ?? null,
          acknowledged: false,
          ackedBy: null,
          ackedAt: null,
          createdAt: new Date(),
        };
        discrepancies.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) => discrepancies.find((d) => d.id === where.id) ?? null),
      findMany: jest.fn(async ({ where, orderBy }: any) => {
        void orderBy;
        let pool = discrepancies.slice();
        if (where?.reportId) pool = pool.filter((d) => d.reportId === where.reportId);
        return pool;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const d = discrepancies.find((x) => x.id === where.id);
        if (!d) throw new Error('no disc');
        Object.assign(d, data);
        return d;
      }),
    },
    coinTransaction: {
      findMany: jest.fn(async ({ distinct }: any) => {
        void distinct;
        return recentUsers.map((userId) => ({ userId }));
      }),
      aggregate: jest.fn(async ({ where }: any) => ({
        _sum: { delta: txByUser[where.userId] ?? 0 },
      })),
    },
  };

  const audit = { record: jest.fn(async () => undefined) };

  const balanceFetcher: BalanceFetcher = {
    fetch: jest.fn(async (userId: string) => {
      const err = opts.balanceErrors?.[userId];
      if (err) throw new Error(err);
      return opts.balances?.[userId] ?? 0;
    }),
  };

  const svc = new ReconciliationService(prisma, audit as any, balanceFetcher);
  return { svc, prisma, audit, balanceFetcher, _reports: () => reports, _discrepancies: () => discrepancies };
}

describe('ReconciliationService.run', () => {
  it('idempotent on the same forDate', async () => {
    const { svc, _reports } = makeMocks({
      txByUser: { 'u-1': 100 },
      balances: { 'u-1': 100 },
    });
    const day = new Date('2026-05-22T00:00:00Z');
    const a = await svc.run({ forDate: day });
    const b = await svc.run({ forDate: day });
    expect(a.alreadyExisted).toBe(false);
    expect(b.alreadyExisted).toBe(true);
    expect(_reports()).toHaveLength(1);
  });

  it('happy path: zero drift → COMPLETED with no discrepancies', async () => {
    const { svc, _reports, _discrepancies } = makeMocks({
      txByUser: { 'u-1': 1000, 'u-2': 500 },
      balances: { 'u-1': 1000, 'u-2': 500 },
    });
    const res = await svc.run({ forDate: new Date('2026-05-22') });
    expect(res.status).toBe(ReconciliationStatus.COMPLETED);
    expect(res.usersChecked).toBe(2);
    expect(res.usersOk).toBe(2);
    expect(res.usersDiscrepant).toBe(0);
    expect(_discrepancies()).toHaveLength(0);
    expect(_reports()[0].totalAbsDrift).toBe(0);
  });

  it('detects positive drift (local > remote)', async () => {
    const { svc, _discrepancies, _reports } = makeMocks({
      txByUser: { 'u-1': 1000 },
      balances: { 'u-1': 800 }, // 200 coins unaccounted-for on Bet
    });
    const res = await svc.run({ forDate: new Date('2026-05-22') });
    expect(res.usersDiscrepant).toBe(1);
    expect(_discrepancies()).toHaveLength(1);
    expect(_discrepancies()[0].drift).toBe(200);
    expect(_reports()[0].totalAbsDrift).toBe(200);
  });

  it('detects negative drift (remote > local)', async () => {
    const { svc, _discrepancies } = makeMocks({
      txByUser: { 'u-1': 500 },
      balances: { 'u-1': 700 }, // 200 coins came from outside our view
    });
    await svc.run({ forDate: new Date('2026-05-22') });
    expect(_discrepancies()[0].drift).toBe(-200);
  });

  it('balance fetch failure is logged as discrepancy, not abort', async () => {
    const { svc, _reports, _discrepancies } = makeMocks({
      txByUser: { 'u-1': 100, 'u-2': 200 },
      balances: { 'u-2': 200 },
      balanceErrors: { 'u-1': 'timeout' },
    });
    const res = await svc.run({ forDate: new Date('2026-05-22') });
    expect(res.status).toBe(ReconciliationStatus.COMPLETED);
    expect(_discrepancies()).toHaveLength(1);
    expect(_discrepancies()[0].notes).toMatch(/balance_fetch_failed/);
    expect(_reports()[0].usersDiscrepant).toBe(1);
    expect(_reports()[0].usersOk).toBe(1);
  });

  it('sums absolute drift across users', async () => {
    const { svc, _reports } = makeMocks({
      txByUser: { 'u-1': 100, 'u-2': 200, 'u-3': 300 },
      balances: { 'u-1': 150, 'u-2': 200, 'u-3': 250 },
    });
    await svc.run({ forDate: new Date('2026-05-22') });
    // |100-150| + |200-200| + |300-250| = 50 + 0 + 50 = 100
    expect(_reports()[0].totalAbsDrift).toBe(100);
    expect(_reports()[0].usersDiscrepant).toBe(2);
    expect(_reports()[0].usersOk).toBe(1);
  });
});

describe('ReconciliationService.toUtcMidnight', () => {
  it('zeros the time component in UTC', () => {
    const d = ReconciliationService.toUtcMidnight(new Date('2026-05-22T17:42:00Z'));
    expect(d.toISOString()).toBe('2026-05-22T00:00:00.000Z');
  });
});

describe('ReconciliationService.acknowledgeDiscrepancy', () => {
  const baseDisc = (overrides: Partial<DiscRow> = {}): DiscRow => ({
    id: 'd-1', reportId: 'r-1', userId: 'u-1',
    localSum: 1000, remoteSum: 800, drift: 200,
    notes: null, acknowledged: false, ackedBy: null, ackedAt: null,
    createdAt: new Date(), ...overrides,
  });

  it('marks acknowledged + writes audit', async () => {
    const { svc, audit, _discrepancies } = makeMocks({ discrepancies: [baseDisc()] });
    await svc.acknowledgeDiscrepancy({
      adminId: 'admin-1', adminEmail: 'admin@kalki.test',
      discrepancyId: 'd-1', notes: 'manual grant explains it',
    });
    expect(_discrepancies()[0].acknowledged).toBe(true);
    expect(_discrepancies()[0].ackedBy).toBe('admin-1');
    expect(_discrepancies()[0].notes).toBe('manual grant explains it');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'recon.ack_discrepancy' }),
    );
  });

  it('idempotent on already-acknowledged', async () => {
    const { svc, audit } = makeMocks({
      discrepancies: [baseDisc({ acknowledged: true, ackedBy: 'admin-prev', ackedAt: new Date() })],
    });
    await svc.acknowledgeDiscrepancy({
      adminId: 'admin-1', adminEmail: 'a@b.c', discrepancyId: 'd-1',
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('400s on too-short notes', async () => {
    const { svc } = makeMocks({ discrepancies: [baseDisc()] });
    await expect(
      svc.acknowledgeDiscrepancy({
        adminId: 'admin-1', adminEmail: 'a@b.c', discrepancyId: 'd-1', notes: 'no',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404 on missing discrepancy', async () => {
    const { svc } = makeMocks();
    await expect(
      svc.acknowledgeDiscrepancy({ adminId: 'admin-1', adminEmail: 'a@b.c', discrepancyId: 'nope' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ReconciliationService.triggerForToday', () => {
  it('runs for today + writes audit', async () => {
    const { svc, audit, _reports } = makeMocks({ txByUser: {}, balances: {} });
    const res = await svc.triggerForToday('admin-1', 'admin@kalki.test');
    expect(res.status).toBe(ReconciliationStatus.COMPLETED);
    expect(_reports()).toHaveLength(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'recon.manual_trigger' }),
    );
  });
});
