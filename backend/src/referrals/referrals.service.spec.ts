import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { OutboxKind, ReferralStatus } from '@prisma/client';
import { ReferralsService } from './referrals.service';

/**
 * Tests cover:
 *
 *   - ensureCode: idempotent, retries on collision (P2002), persists.
 *   - claim: refuses self / unknown code / already-claimed, persists
 *     IP + device-hash fingerprints.
 *   - maybeQualify: KYC gate, deposit gate, idempotent on already-
 *     qualified, enqueues exactly two BET_WALLET_CREDIT outbox rows
 *     with deterministic idempotency keys (referrer + referee).
 *   - voidClaim: 400s on short reason, 409s on already-PAID, flips
 *     PENDING → VOIDED.
 *   - generateCode: avoids 0/O/1/I/l (CODE_ALPHABET assertion).
 */

interface UserRow {
  id: string;
  referralCode: string | null;
}

interface ClaimRow {
  id: string;
  referrerId: string;
  refereeId: string;
  code: string;
  status: ReferralStatus;
  referrerRewardCoins: number;
  refereeRewardCoins: number;
  qualifiedAt: Date | null;
  paidAt: Date | null;
  voidReason: string | null;
  refereeSignupIp: string | null;
  refereeSignupDeviceHash: string | null;
}

function makeMocks(opts: {
  users?: UserRow[];
  claims?: ClaimRow[];
  kyc?: Array<{ userId: string; tier: string }>;
  deposits?: number;
  collisionsBeforeSuccess?: number;
  settings?: Record<string, number>;
} = {}) {
  const users = new Map<string, UserRow>((opts.users ?? []).map((u) => [u.id, { ...u }]));
  const claims = (opts.claims ?? []).map((c) => ({ ...c }));
  const kyc = new Map<string, { tier: string }>((opts.kyc ?? []).map((k) => [k.userId, { tier: k.tier }]));
  let txAttempt = 0;
  const collisionsToFire = opts.collisionsBeforeSuccess ?? 0;

  const outbox = { enqueue: jest.fn(async (_tx: unknown, _data: any) => undefined) };
  const settings = {
    getInt: jest.fn(async (key: string, fallback: number) =>
      opts.settings?.[key] ?? fallback,
    ),
  };
  const notifications = { enqueue: jest.fn(async () => undefined) };

  const prisma: any = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id) return users.get(where.id) ?? null;
        if (where.referralCode) {
          for (const u of users.values()) {
            if (u.referralCode === where.referralCode) return { id: u.id };
          }
        }
        return null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        if (txAttempt < collisionsToFire && data.referralCode) {
          txAttempt += 1;
          const err: any = new Error('unique');
          err.code = 'P2002';
          throw err;
        }
        const u = users.get(where.id);
        if (!u) throw new Error('no user');
        Object.assign(u, data);
        return u;
      }),
    },
    referralClaim: {
      create: jest.fn(async ({ data }: any) => {
        const dup = claims.find((c) => c.refereeId === data.refereeId);
        if (dup) {
          const err: any = new Error('unique');
          err.code = 'P2002';
          throw err;
        }
        const row: ClaimRow = {
          id: `cl-${claims.length + 1}`,
          referrerId: data.referrerId,
          refereeId: data.refereeId,
          code: data.code,
          status: data.status,
          referrerRewardCoins: data.referrerRewardCoins,
          refereeRewardCoins: data.refereeRewardCoins,
          qualifiedAt: null,
          paidAt: null,
          voidReason: null,
          refereeSignupIp: data.refereeSignupIp ?? null,
          refereeSignupDeviceHash: data.refereeSignupDeviceHash ?? null,
        };
        claims.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.refereeId) return claims.find((c) => c.refereeId === where.refereeId) ?? null;
        if (where.id) return claims.find((c) => c.id === where.id) ?? null;
        return null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        claims.filter((c) => c.referrerId === where.referrerId),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const c = claims.find((x) => x.id === where.id);
        if (!c) throw new Error('no claim');
        Object.assign(c, data);
        return c;
      }),
      // Conditional flip used by maybeQualify — only rows matching the
      // full `where` (id + status) are updated, mirroring the DB.
      updateMany: jest.fn(async ({ where, data }: any) => {
        const matches = claims.filter(
          (c) =>
            (where.id === undefined || c.id === where.id) &&
            (where.status === undefined || c.status === where.status),
        );
        for (const c of matches) Object.assign(c, data);
        return { count: matches.length };
      }),
    },
    kycVerification: {
      findUnique: jest.fn(async ({ where }: any) => kyc.get(where.userId) ?? null),
    },
    coinTransaction: {
      aggregate: jest.fn(async () => ({ _sum: { delta: opts.deposits ?? 0 } })),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };

  const svc = new ReferralsService(prisma, outbox as any, settings as any, notifications as any);
  return { svc, prisma, outbox, settings, notifications, _claims: () => claims, _users: () => users };
}

describe('ReferralsService.ensureCode', () => {
  it('mints a new code on first call', async () => {
    const { svc, _users } = makeMocks({ users: [{ id: 'u-1', referralCode: null }] });
    const code = await svc.ensureCode('u-1');
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    expect(_users().get('u-1')!.referralCode).toBe(code);
  });

  it('returns existing code on subsequent calls', async () => {
    const { svc } = makeMocks({ users: [{ id: 'u-1', referralCode: 'ABCD2345' }] });
    expect(await svc.ensureCode('u-1')).toBe('ABCD2345');
  });

  it('retries on P2002 collision', async () => {
    const { svc, prisma } = makeMocks({
      users: [{ id: 'u-1', referralCode: null }],
      collisionsBeforeSuccess: 2,
    });
    const code = await svc.ensureCode('u-1');
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    // 2 collisions + 1 success = 3 update attempts.
    expect(prisma.user.update).toHaveBeenCalledTimes(3);
  });

  it('404s on unknown user', async () => {
    const { svc } = makeMocks({});
    await expect(svc.ensureCode('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ReferralsService.claim', () => {
  it('refuses self-referral', async () => {
    const { svc } = makeMocks({
      users: [
        { id: 'u-1', referralCode: 'OWNCODE1' },
        { id: 'u-2', referralCode: 'ABCD2345' },
      ],
    });
    await expect(
      svc.claim({ refereeUserId: 'u-1', code: 'OWNCODE1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses unknown code', async () => {
    const { svc } = makeMocks({
      users: [{ id: 'u-2', referralCode: 'OTHER' }],
    });
    await expect(
      svc.claim({ refereeUserId: 'u-2', code: 'NOPE' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persists IP + device fingerprints', async () => {
    const { svc, _claims } = makeMocks({
      users: [
        { id: 'u-1', referralCode: 'ABCD2345' },
        { id: 'u-2', referralCode: null },
      ],
    });
    await svc.claim({
      refereeUserId: 'u-2',
      code: 'ABCD2345',
      signupIp: '1.2.3.4',
      signupDeviceHash: 'sha-abc',
    });
    expect(_claims()[0].refereeSignupIp).toBe('1.2.3.4');
    expect(_claims()[0].refereeSignupDeviceHash).toBe('sha-abc');
  });

  it('refuses second claim (one-shot enforced via P2002)', async () => {
    const { svc } = makeMocks({
      users: [
        { id: 'u-1', referralCode: 'ABCD2345' },
        { id: 'u-2', referralCode: null },
      ],
    });
    await svc.claim({ refereeUserId: 'u-2', code: 'ABCD2345' });
    await expect(
      svc.claim({ refereeUserId: 'u-2', code: 'ABCD2345' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('code is normalised to uppercase + trimmed', async () => {
    const { svc, _claims } = makeMocks({
      users: [
        { id: 'u-1', referralCode: 'ABCD2345' },
        { id: 'u-2', referralCode: null },
      ],
    });
    await svc.claim({ refereeUserId: 'u-2', code: '  abcd2345  ' });
    expect(_claims()[0].code).toBe('ABCD2345');
  });
});

describe('ReferralsService.maybeQualify', () => {
  function setupQualified() {
    return makeMocks({
      users: [
        { id: 'referrer', referralCode: 'CODE' },
        { id: 'referee', referralCode: null },
      ],
      claims: [
        {
          id: 'cl-1',
          referrerId: 'referrer',
          refereeId: 'referee',
          code: 'CODE',
          status: ReferralStatus.PENDING,
          referrerRewardCoins: 500,
          refereeRewardCoins: 250,
          qualifiedAt: null,
          paidAt: null,
          voidReason: null,
          refereeSignupIp: null,
          refereeSignupDeviceHash: null,
        },
      ],
      kyc: [{ userId: 'referee', tier: 'TIER_1' }],
      deposits: 2000,
      settings: { 'referral.qualification_deposit_min_coins': 1000 },
    });
  }

  it('refuses qualification when KYC tier is still 0', async () => {
    const { svc } = makeMocks({
      claims: [
        {
          id: 'cl-1',
          referrerId: 'a',
          refereeId: 'referee',
          code: 'CODE',
          status: ReferralStatus.PENDING,
          referrerRewardCoins: 500,
          refereeRewardCoins: 250,
          qualifiedAt: null,
          paidAt: null,
          voidReason: null,
          refereeSignupIp: null,
          refereeSignupDeviceHash: null,
        },
      ],
      kyc: [{ userId: 'referee', tier: 'TIER_0' }],
      deposits: 10000,
    });
    const res = await svc.maybeQualify('referee');
    expect(res.qualified).toBe(false);
  });

  it('refuses qualification when total deposits below the gate', async () => {
    const { svc } = makeMocks({
      claims: [
        {
          id: 'cl-1',
          referrerId: 'a',
          refereeId: 'referee',
          code: 'CODE',
          status: ReferralStatus.PENDING,
          referrerRewardCoins: 500,
          refereeRewardCoins: 250,
          qualifiedAt: null,
          paidAt: null,
          voidReason: null,
          refereeSignupIp: null,
          refereeSignupDeviceHash: null,
        },
      ],
      kyc: [{ userId: 'referee', tier: 'TIER_1' }],
      deposits: 500, // below the 1000 min
      settings: { 'referral.qualification_deposit_min_coins': 1000 },
    });
    const res = await svc.maybeQualify('referee');
    expect(res.qualified).toBe(false);
  });

  it('flips PENDING → QUALIFIED + enqueues both outbox credits', async () => {
    const { svc, outbox, _claims } = setupQualified();
    const res = await svc.maybeQualify('referee');
    expect(res.qualified).toBe(true);
    expect(_claims()[0].status).toBe(ReferralStatus.QUALIFIED);
    expect(_claims()[0].qualifiedAt).toBeInstanceOf(Date);

    // Two BET_WALLET_CREDIT rows, one per side, with deterministic keys.
    expect(outbox.enqueue).toHaveBeenCalledTimes(2);
    const keys = outbox.enqueue.mock.calls.map((c: any) => c[1].idempotencyKey);
    expect(keys).toEqual([`referral:cl-1:referrer`, `referral:cl-1:referee`]);
    const kinds = outbox.enqueue.mock.calls.map((c: any) => c[1].kind);
    expect(kinds.every((k: OutboxKind) => k === OutboxKind.BET_WALLET_CREDIT)).toBe(true);
  });

  it('idempotent: second call after QUALIFIED is a no-op', async () => {
    const { svc, outbox } = setupQualified();
    await svc.maybeQualify('referee');
    outbox.enqueue.mockClear();
    const res2 = await svc.maybeQualify('referee');
    expect(res2.qualified).toBe(true);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('returns qualified:false when there is no claim', async () => {
    const { svc } = makeMocks({});
    const res = await svc.maybeQualify('any-user');
    expect(res.qualified).toBe(false);
  });

  it('concurrent loser (conditional flip count=0): no double enqueue, still reports qualified', async () => {
    const { svc, prisma, outbox } = setupQualified();
    // Simulate a concurrent caller that flipped the row between our
    // findUnique (read PENDING) and our conditional updateMany. The
    // loser must NOT enqueue a second pair of payouts.
    prisma.referralClaim.updateMany = jest.fn(async () => ({ count: 0 }));
    const res = await svc.maybeQualify('referee');
    expect(res.qualified).toBe(true);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
});

describe('ReferralsService.voidClaim', () => {
  it('400s on short reason', async () => {
    const { svc } = makeMocks({
      claims: [
        {
          id: 'cl-1',
          referrerId: 'r',
          refereeId: 'u',
          code: 'CODE',
          status: ReferralStatus.PENDING,
          referrerRewardCoins: 500,
          refereeRewardCoins: 250,
          qualifiedAt: null,
          paidAt: null,
          voidReason: null,
          refereeSignupIp: null,
          refereeSignupDeviceHash: null,
        },
      ],
    });
    await expect(
      svc.voidClaim({ adminId: 'admin-1', claimId: 'cl-1', reason: 'no' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses voiding a PAID claim (must claw back via wallet tool)', async () => {
    const { svc } = makeMocks({
      claims: [
        {
          id: 'cl-1',
          referrerId: 'r',
          refereeId: 'u',
          code: 'CODE',
          status: ReferralStatus.PAID,
          referrerRewardCoins: 500,
          refereeRewardCoins: 250,
          qualifiedAt: new Date(),
          paidAt: new Date(),
          voidReason: null,
          refereeSignupIp: null,
          refereeSignupDeviceHash: null,
        },
      ],
    });
    await expect(
      svc.voidClaim({ adminId: 'admin-1', claimId: 'cl-1', reason: 'suspect fraud' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('flips PENDING → VOIDED with reason', async () => {
    const { svc, _claims } = makeMocks({
      claims: [
        {
          id: 'cl-1',
          referrerId: 'r',
          refereeId: 'u',
          code: 'CODE',
          status: ReferralStatus.PENDING,
          referrerRewardCoins: 500,
          refereeRewardCoins: 250,
          qualifiedAt: null,
          paidAt: null,
          voidReason: null,
          refereeSignupIp: null,
          refereeSignupDeviceHash: null,
        },
      ],
    });
    const r = await svc.voidClaim({ adminId: 'admin-1', claimId: 'cl-1', reason: 'same IP cluster' });
    expect(r.status).toBe(ReferralStatus.VOIDED);
    expect(_claims()[0].voidReason).toBe('same IP cluster');
  });
});

describe('ReferralsService.generateCode', () => {
  it('uses the unambiguous alphabet (no 0/O/1/I/l)', () => {
    for (let i = 0; i < 50; i++) {
      const code = ReferralsService.generateCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]+$/);
      expect(code.length).toBe(8);
    }
  });
});
