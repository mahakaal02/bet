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

interface UserRow {
  id: string;
  bannedAt: Date | null;
  bannedReason: string | null;
  bannedBy: string | null;
}

function makeMocks(opts: {
  bids?: BidRow[];
  claims?: ClaimRow[];
  signals?: SignalRow[];
  settings?: Record<string, number>;
  users?: UserRow[];
} = {}) {
  const bids = (opts.bids ?? []).slice();
  const claims = (opts.claims ?? []).slice();
  const signals = (opts.signals ?? []).map((s) => ({ ...s }));
  const users = (opts.users ?? []).map((u) => ({ ...u }));

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
    user: {
      findUnique: jest.fn(async ({ where }: any) => users.find((u) => u.id === where.id) ?? null),
      findMany: jest.fn(async ({ where, select }: any) => {
        void select;
        const idSet = new Set((where?.id?.in ?? []) as string[]);
        return users.filter((u) => idSet.has(u.id));
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const u = users.find((x) => x.id === where.id);
        if (!u) throw new Error(`no user ${where.id}`);
        Object.assign(u, data);
        return u;
      }),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };
  const audit = { record: jest.fn(async () => undefined) };
  const settings = {
    getInt: jest.fn(async (key: string, fallback: number) => opts.settings?.[key] ?? fallback),
  };
  const svc = new FraudService(prisma, audit as any, settings as any);
  return { svc, prisma, audit, _signals: () => signals, _users: () => users };
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

// ─── PR-FRAUD-2: bulk + ban actions ───────────────────────────────

const baseSignal = (overrides: Partial<SignalRow> = {}): SignalRow => ({
  id: 's-1', kind: FraudSignalKind.VELOCITY_BID, severity: FraudSeverity.MEDIUM,
  userId: 'u-1', clusterKey: null, affectedUserIds: null,
  metadata: { count: 60, threshold: 30 },
  reviewed: false, reviewedBy: null, reviewedAt: null, notes: null,
  createdAt: new Date(), ...overrides,
});

const baseUser = (overrides: Partial<UserRow> = {}): UserRow => ({
  id: 'u-1', bannedAt: null, bannedReason: null, bannedBy: null, ...overrides,
});

describe('FraudService.bulkReview', () => {
  it('400s on empty signalIds', async () => {
    const { svc } = makeMocks();
    await expect(
      svc.bulkReview({ adminId: 'admin-1', adminEmail: 'a@b.c', signalIds: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400s on > 100 signalIds', async () => {
    const { svc } = makeMocks();
    const ids = Array.from({ length: 101 }, (_, i) => `s-${i}`);
    await expect(
      svc.bulkReview({ adminId: 'admin-1', adminEmail: 'a@b.c', signalIds: ids }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s on any missing signalId', async () => {
    const { svc } = makeMocks({ signals: [baseSignal()] });
    await expect(
      svc.bulkReview({ adminId: 'admin-1', adminEmail: 'a@b.c', signalIds: ['s-1', 'nope'] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('400s on too-short batchNote', async () => {
    const { svc } = makeMocks({ signals: [baseSignal()] });
    await expect(
      svc.bulkReview({ adminId: 'admin-1', adminEmail: 'a@b.c', signalIds: ['s-1'], batchNote: 'no' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('flips unreviewed signals, skips already-reviewed, audits per row', async () => {
    const { svc, audit, _signals } = makeMocks({
      signals: [
        baseSignal({ id: 's-1', reviewed: false }),
        baseSignal({ id: 's-2', reviewed: true, reviewedBy: 'admin-prev', reviewedAt: new Date() }),
        baseSignal({ id: 's-3', reviewed: false }),
      ],
    });
    const r = await svc.bulkReview({
      adminId: 'admin-1', adminEmail: 'a@b.c',
      signalIds: ['s-1', 's-2', 's-3'], batchNote: 'end-of-day triage',
    });
    expect(r.reviewed).toBe(2);
    expect(r.skipped).toBe(1);
    expect(_signals().filter((s) => s.reviewed).length).toBe(3);
    // Two audit rows — one per flip, not one for the batch.
    expect(audit.record.mock.calls.filter((c: any) => c[0].action === 'fraud.signal_reviewed_bulk').length).toBe(2);
  });
});

describe('FraudService.banAffectedUsers', () => {
  const clusterSignal = (overrides: Partial<SignalRow> = {}): SignalRow => ({
    ...baseSignal({
      id: 's-cluster', kind: FraudSignalKind.CLUSTER_IP,
      userId: null, clusterKey: '1.2.3.4',
      affectedUserIds: ['u-1', 'u-2', 'u-3'],
    }),
    ...overrides,
  });

  it('400s on short reason', async () => {
    const { svc } = makeMocks({ signals: [clusterSignal()] });
    await expect(
      svc.banAffectedUsers({ adminId: 'admin-1', adminEmail: 'a@b.c', signalId: 's-cluster', reason: 'no' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s on unknown signal', async () => {
    const { svc } = makeMocks();
    await expect(
      svc.banAffectedUsers({ adminId: 'admin-1', adminEmail: 'a@b.c', signalId: 'nope', reason: 'cluster of fraud accounts' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses velocity (single-user) signals', async () => {
    const { svc } = makeMocks({
      signals: [baseSignal({ id: 's-velocity', userId: 'u-1', clusterKey: null })],
    });
    await expect(
      svc.banAffectedUsers({ adminId: 'admin-1', adminEmail: 'a@b.c', signalId: 's-velocity', reason: 'velocity spam bot' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses cluster with empty affectedUserIds', async () => {
    const { svc } = makeMocks({
      signals: [clusterSignal({ affectedUserIds: [] })],
    });
    await expect(
      svc.banAffectedUsers({ adminId: 'admin-1', adminEmail: 'a@b.c', signalId: 's-cluster', reason: 'expected affected list' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bans all affected users, audits per user, marks signal reviewed', async () => {
    const { svc, audit, _users, _signals } = makeMocks({
      signals: [clusterSignal()],
      users: [
        baseUser({ id: 'u-1' }),
        baseUser({ id: 'u-2' }),
        baseUser({ id: 'u-3' }),
      ],
    });
    const r = await svc.banAffectedUsers({
      adminId: 'admin-1', adminEmail: 'admin@kalki.test',
      signalId: 's-cluster', reason: 'coordinated IP cluster on suspicious infrastructure',
    });
    expect(r.bannedUserIds.sort()).toEqual(['u-1', 'u-2', 'u-3']);
    expect(r.alreadyBanned).toEqual([]);
    expect(_users().every((u) => u.bannedAt !== null)).toBe(true);
    expect(_users()[0].bannedReason).toContain('fraud_cluster:s-cluster');
    // Per-user audit rows.
    const banAudits = audit.record.mock.calls.filter((c: any) => c[0].action === 'fraud.user_banned');
    expect(banAudits.length).toBe(3);
    // Signal flipped reviewed as a side effect.
    expect(_signals()[0].reviewed).toBe(true);
  });

  it('refreshes ban reason on already-banned users, separate audit event', async () => {
    const oldBan = new Date(Date.now() - 7 * 24 * 60 * 60_000);
    const { svc, audit, _users } = makeMocks({
      signals: [clusterSignal({ affectedUserIds: ['u-1', 'u-2'] })],
      users: [
        baseUser({ id: 'u-1', bannedAt: oldBan, bannedReason: 'old reason', bannedBy: 'admin-old' }),
        baseUser({ id: 'u-2' }),
      ],
    });
    const r = await svc.banAffectedUsers({
      adminId: 'admin-1', adminEmail: 'a@b.c',
      signalId: 's-cluster', reason: 'cluster signal re-fired against this set',
    });
    expect(r.bannedUserIds).toEqual(['u-2']);
    expect(r.alreadyBanned).toEqual(['u-1']);
    // u-1's original bannedAt is preserved (forensic timeline intact).
    const u1 = _users().find((u) => u.id === 'u-1')!;
    expect(u1.bannedAt!.getTime()).toBe(oldBan.getTime());
    expect(u1.bannedReason).toContain('fraud_cluster:s-cluster');
    // Refresh-audit row, not a fresh ban-audit row, for u-1.
    expect(audit.record.mock.calls.some((c: any) => c[0].action === 'fraud.user_ban_refreshed' && c[0].targetId === 'u-1')).toBe(true);
    expect(audit.record.mock.calls.some((c: any) => c[0].action === 'fraud.user_banned' && c[0].targetId === 'u-2')).toBe(true);
  });
});

describe('FraudService.unbanUser', () => {
  it('400s on too-short reason', async () => {
    const { svc } = makeMocks({ users: [baseUser({ bannedAt: new Date() })] });
    await expect(
      svc.unbanUser({ adminId: 'admin-1', adminEmail: 'a@b.c', userId: 'u-1', reason: 'no' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s on unknown user', async () => {
    const { svc } = makeMocks();
    await expect(
      svc.unbanUser({ adminId: 'admin-1', adminEmail: 'a@b.c', userId: 'nope', reason: 'false positive verified' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns wasBanned:false when user not banned (no-op)', async () => {
    const { svc, _users, audit } = makeMocks({ users: [baseUser({ bannedAt: null })] });
    const r = await svc.unbanUser({
      adminId: 'admin-1', adminEmail: 'a@b.c', userId: 'u-1', reason: 'verified clean',
    });
    expect(r.wasBanned).toBe(false);
    expect(_users()[0].bannedAt).toBeNull();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('clears the ban + audits', async () => {
    const { svc, audit, _users } = makeMocks({
      users: [baseUser({ bannedAt: new Date(), bannedReason: 'something', bannedBy: 'admin-old' })],
    });
    const r = await svc.unbanUser({
      adminId: 'admin-1', adminEmail: 'admin@kalki.test',
      userId: 'u-1', reason: 'office wifi false positive',
    });
    expect(r.wasBanned).toBe(true);
    expect(_users()[0].bannedAt).toBeNull();
    expect(_users()[0].bannedReason).toBeNull();
    expect(_users()[0].bannedBy).toBeNull();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'fraud.user_unbanned' }),
    );
  });
});
