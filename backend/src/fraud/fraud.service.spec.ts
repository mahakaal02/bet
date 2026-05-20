import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FraudSeverity, FraudSignalKind } from '@prisma/client';
import { FraudService } from './fraud.service';

interface SignalRow {
  id: string;
  kind: FraudSignalKind;
  severity: FraudSeverity;
  userId: string | null;
  clusterKey: string | null;
  affectedUserIds: unknown;
  metadata: unknown;
  reviewed: boolean;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  notes: string | null;
  createdAt: Date;
}

interface BidRow {
  userId: string;
  createdAt: Date;
}

interface ClaimRow {
  refereeId: string;
  referrerId: string;
  refereeSignupIp: string | null;
  refereeSignupDeviceHash: string | null;
  createdAt: Date;
}

function makeMocks(opts: {
  bids?: BidRow[];
  claims?: ClaimRow[];
  signals?: SignalRow[];
  settings?: Record<string, number>;
} = {}) {
  const bids = (opts.bids ?? []).slice();
  const claims = (opts.claims ?? []).slice();
  const signals = (opts.signals ?? []).map((s) => ({ ...s }));

  const prisma: any = {
    bid: {
      count: jest.fn(async ({ where }: any) =>
        bids.filter((b) =>
          b.userId === where.userId &&
          (!where.createdAt?.gte || b.createdAt >= where.createdAt.gte),
        ).length,
      ),
    },
    referralClaim: {
      groupBy: jest.fn(async ({ by, where }: any) => {
        const since = where?.createdAt?.gte as Date | undefined;
        const pool = claims.filter((c) => {
          if (since && c.createdAt < since) return false;
          if (where?.refereeSignupIp?.not !== undefined && c.refereeSignupIp === null) return false;
          if (where?.refereeSignupDeviceHash?.not !== undefined && c.refereeSignupDeviceHash === null) return false;
          return true;
        });
        const map = new Map<string | null, number>();
        for (const c of pool) {
          let key: string | null;
          if (by[0] === 'refereeSignupIp') key = c.refereeSignupIp;
          else if (by[0] === 'refereeSignupDeviceHash') key = c.refereeSignupDeviceHash;
          else if (by[0] === 'referrerId') key = c.referrerId;
          else key = null;
          map.set(key, (map.get(key) ?? 0) + 1);
        }
        return Array.from(map.entries()).map(([k, n]) => {
          const row: Record<string, unknown> = { _count: { refereeId: n } };
          row[by[0]] = k;
          return row;
        });
      }),
      findMany: jest.fn(async ({ where, select }: any) => {
        void select;
        const since = where?.createdAt?.gte as Date | undefined;
        return claims.filter((c) => {
          if (since && c.createdAt < since) return false;
          if (where?.refereeSignupIp && c.refereeSignupIp !== where.refereeSignupIp) return false;
          if (where?.refereeSignupDeviceHash && c.refereeSignupDeviceHash !== where.refereeSignupDeviceHash) return false;
          if (where?.referrerId && c.referrerId !== where.referrerId) return false;
          return true;
        });
      }),
    },
    fraudSignal: {
      findFirst: jest.fn(async ({ where }: any) =>
        signals.find((s) => {
          if (where.kind && s.kind !== where.kind) return false;
          if (where.userId && s.userId !== where.userId) return false;
          if (where.clusterKey && s.clusterKey !== where.clusterKey) return false;
          if (where.createdAt?.gte && s.createdAt < where.createdAt.gte) return false;
          return true;
        }) ?? null,
      ),
      findUnique: jest.fn(async ({ where }: any) => signals.find((s) => s.id === where.id) ?? null),
      findMany: jest.fn(async ({ where, take, cursor, skip, orderBy }: any) => {
        void orderBy;
        let pool = signals.slice();
        if (where) {
          if (where.reviewed !== undefined) pool = pool.filter((s) => s.reviewed === where.reviewed);
          if (where.severity) pool = pool.filter((s) => s.severity === where.severity);
          if (where.kind) pool = pool.filter((s) => s.kind === where.kind);
        }
        pool.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (cursor) {
          const idx = pool.findIndex((s) => s.id === cursor.id);
          if (idx >= 0) pool = pool.slice(idx + (skip ?? 0));
        }
        return pool.slice(0, take);
      }),
      create: jest.fn(async ({ data }: any) => {
        const row: SignalRow = {
          id: `s-${signals.length + 1}`,
          kind: data.kind,
          severity: data.severity,
          userId: data.userId ?? null,
          clusterKey: data.clusterKey ?? null,
          affectedUserIds: data.affectedUserIds ?? null,
          metadata: data.metadata,
          reviewed: false,
          reviewedBy: null,
          reviewedAt: null,
          notes: null,
          createdAt: new Date(),
        };
        signals.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const s = signals.find((x) => x.id === where.id);
        if (!s) throw new Error('no signal');
        Object.assign(s, data);
        return s;
      }),
    },
  };
  const audit = { record: jest.fn(async () => undefined) };
  const settings = {
    getInt: jest.fn(async (key: string, fallback: number) => opts.settings?.[key] ?? fallback),
  };
  const svc = new FraudService(prisma, audit as any, settings as any);
  return { svc, prisma, audit, _signals: () => signals };
}

describe('FraudService.severityFor', () => {
  it('LOW under 2× threshold', () => {
    expect(FraudService.severityFor(35, 30)).toBe(FraudSeverity.LOW);
  });
  it('MEDIUM at 2× threshold', () => {
    expect(FraudService.severityFor(60, 30)).toBe(FraudSeverity.MEDIUM);
  });
  it('HIGH at 5× threshold', () => {
    expect(FraudService.severityFor(150, 30)).toBe(FraudSeverity.HIGH);
  });
});

describe('FraudService.checkBidVelocity', () => {
  it('no signal when below threshold', async () => {
    const bids: BidRow[] = Array.from({ length: 5 }, () => ({ userId: 'u-1', createdAt: new Date() }));
    const { svc, _signals } = makeMocks({ bids, settings: { 'fraud.velocity_bid_count': 10 } });
    await svc.checkBidVelocity('u-1');
    expect(_signals()).toHaveLength(0);
  });

  it('fires LOW signal at exact threshold', async () => {
    const bids: BidRow[] = Array.from({ length: 10 }, () => ({ userId: 'u-1', createdAt: new Date() }));
    const { svc, _signals } = makeMocks({ bids, settings: { 'fraud.velocity_bid_count': 10 } });
    await svc.checkBidVelocity('u-1');
    expect(_signals()).toHaveLength(1);
    expect(_signals()[0].severity).toBe(FraudSeverity.LOW);
  });

  it('escalates to HIGH at 5× threshold', async () => {
    const bids: BidRow[] = Array.from({ length: 50 }, () => ({ userId: 'u-1', createdAt: new Date() }));
    const { svc, _signals } = makeMocks({ bids, settings: { 'fraud.velocity_bid_count': 10 } });
    await svc.checkBidVelocity('u-1');
    expect(_signals()[0].severity).toBe(FraudSeverity.HIGH);
  });

  it('deduplicates within the same window', async () => {
    const bids: BidRow[] = Array.from({ length: 30 }, () => ({ userId: 'u-1', createdAt: new Date() }));
    const { svc, _signals } = makeMocks({ bids, settings: { 'fraud.velocity_bid_count': 10 } });
    await svc.checkBidVelocity('u-1');
    await svc.checkBidVelocity('u-1');
    expect(_signals()).toHaveLength(1);
  });
});

describe('FraudService.detectIpClusters', () => {
  it('flags IPs shared by ≥ threshold distinct referees', async () => {
    const claims: ClaimRow[] = [
      { refereeId: 'u-1', referrerId: 'r-1', refereeSignupIp: '1.2.3.4', refereeSignupDeviceHash: null, createdAt: new Date() },
      { refereeId: 'u-2', referrerId: 'r-1', refereeSignupIp: '1.2.3.4', refereeSignupDeviceHash: null, createdAt: new Date() },
      { refereeId: 'u-3', referrerId: 'r-2', refereeSignupIp: '1.2.3.4', refereeSignupDeviceHash: null, createdAt: new Date() },
      { refereeId: 'u-4', referrerId: 'r-3', refereeSignupIp: '5.6.7.8', refereeSignupDeviceHash: null, createdAt: new Date() },
    ];
    const { svc, _signals } = makeMocks({ claims, settings: { 'fraud.cluster_ip_min_users': 3 } });
    const res = await svc.detectIpClusters();
    expect(res.created).toBe(1);
    expect(_signals()[0].kind).toBe(FraudSignalKind.CLUSTER_IP);
    expect(_signals()[0].clusterKey).toBe('1.2.3.4');
    expect((_signals()[0].affectedUserIds as string[]).sort()).toEqual(['u-1', 'u-2', 'u-3']);
  });

  it('dedupes — re-running within the window doesn\'t double up', async () => {
    const claims: ClaimRow[] = Array.from({ length: 5 }, (_, i) => ({
      refereeId: `u-${i}`, referrerId: `r-${i}`,
      refereeSignupIp: '1.2.3.4', refereeSignupDeviceHash: null, createdAt: new Date(),
    }));
    const { svc, _signals } = makeMocks({ claims, settings: { 'fraud.cluster_ip_min_users': 3 } });
    await svc.detectIpClusters();
    await svc.detectIpClusters();
    expect(_signals()).toHaveLength(1);
  });
});

describe('FraudService.detectDeviceClusters', () => {
  it('flags device hashes shared by ≥ threshold referees', async () => {
    const claims: ClaimRow[] = [
      { refereeId: 'u-1', referrerId: 'r-1', refereeSignupIp: null, refereeSignupDeviceHash: 'sha-A', createdAt: new Date() },
      { refereeId: 'u-2', referrerId: 'r-2', refereeSignupIp: null, refereeSignupDeviceHash: 'sha-A', createdAt: new Date() },
      { refereeId: 'u-3', referrerId: 'r-3', refereeSignupIp: null, refereeSignupDeviceHash: 'sha-A', createdAt: new Date() },
    ];
    const { svc, _signals } = makeMocks({ claims, settings: { 'fraud.cluster_device_min_users': 3 } });
    const res = await svc.detectDeviceClusters();
    expect(res.created).toBe(1);
    expect(_signals()[0].kind).toBe(FraudSignalKind.CLUSTER_DEVICE);
  });
});

describe('FraudService.detectReferralVelocity', () => {
  it('flags referrers with ≥ N referees in 24h', async () => {
    const claims: ClaimRow[] = Array.from({ length: 7 }, (_, i) => ({
      refereeId: `u-${i}`, referrerId: 'r-fast',
      refereeSignupIp: null, refereeSignupDeviceHash: null, createdAt: new Date(),
    }));
    const { svc, _signals } = makeMocks({ claims, settings: { 'fraud.cluster_referral_min_referees': 5 } });
    await svc.detectReferralVelocity();
    expect(_signals()).toHaveLength(1);
    expect(_signals()[0].kind).toBe(FraudSignalKind.CLUSTER_REFERRAL);
    expect(_signals()[0].clusterKey).toBe('r-fast');
  });
});

describe('FraudService.reviewSignal', () => {
  const baseSignal = (overrides: Partial<SignalRow> = {}): SignalRow => ({
    id: 's-1', kind: FraudSignalKind.VELOCITY_BID, severity: FraudSeverity.MEDIUM,
    userId: 'u-1', clusterKey: null, affectedUserIds: null,
    metadata: { count: 60, threshold: 30 },
    reviewed: false, reviewedBy: null, reviewedAt: null, notes: null,
    createdAt: new Date(), ...overrides,
  });

  it('marks reviewed + audits', async () => {
    const { svc, audit, _signals } = makeMocks({ signals: [baseSignal()] });
    await svc.reviewSignal({
      adminId: 'admin-1', adminEmail: 'admin@kalki.test',
      signalId: 's-1', notes: 'manual review confirms benign',
    });
    expect(_signals()[0].reviewed).toBe(true);
    expect(_signals()[0].notes).toBe('manual review confirms benign');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'fraud.signal_reviewed' }),
    );
  });

  it('400s on too-short notes', async () => {
    const { svc } = makeMocks({ signals: [baseSignal()] });
    await expect(
      svc.reviewSignal({ adminId: 'admin-1', adminEmail: 'a@b.c', signalId: 's-1', notes: 'no' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('idempotent on already-reviewed', async () => {
    const { svc, audit } = makeMocks({
      signals: [baseSignal({ reviewed: true, reviewedBy: 'admin-prev', reviewedAt: new Date() })],
    });
    await svc.reviewSignal({ adminId: 'admin-1', adminEmail: 'a@b.c', signalId: 's-1' });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('404 on missing', async () => {
    const { svc } = makeMocks();
    await expect(
      svc.reviewSignal({ adminId: 'admin-1', adminEmail: 'a@b.c', signalId: 'nope' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('FraudService.runClusterSweep', () => {
  it('runs all 3 cluster detectors', async () => {
    const claims: ClaimRow[] = Array.from({ length: 6 }, (_, i) => ({
      refereeId: `u-${i}`, referrerId: 'r-1',
      refereeSignupIp: '1.1.1.1', refereeSignupDeviceHash: 'sha-A', createdAt: new Date(),
    }));
    const { svc, _signals } = makeMocks({
      claims,
      settings: {
        'fraud.cluster_ip_min_users': 3,
        'fraud.cluster_device_min_users': 3,
        'fraud.cluster_referral_min_referees': 5,
      },
    });
    const res = await svc.runClusterSweep();
    expect(res.ipClusters).toBe(1);
    expect(res.deviceClusters).toBe(1);
    expect(res.referralClusters).toBe(1);
    expect(_signals()).toHaveLength(3);
  });
});
