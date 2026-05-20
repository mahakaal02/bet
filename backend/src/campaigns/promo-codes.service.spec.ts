import { BadRequestException, ConflictException } from '@nestjs/common';
import { PromoCodeDiscountType } from '@prisma/client';
import { computeDiscount, PromoCodesService } from './promo-codes.service';

interface PromoRow {
  id: string;
  code: string;
  discountType: PromoCodeDiscountType;
  discountValue: number;
  maxUses: number | null;
  maxUsesPerUser: number;
  expiresAt: Date | null;
  coinPackIds: string[];
  enabled: boolean;
  createdBy: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RedemptionRow {
  id: string;
  promoCodeId: string;
  userId: string;
  paymentOrderId: string | null;
  discountInr: number;
  createdAt: Date;
}

function makeMocks(opts: {
  promos?: PromoRow[];
  redemptions?: RedemptionRow[];
} = {}) {
  const promos = (opts.promos ?? []).map((p) => ({ ...p }));
  const redemptions = (opts.redemptions ?? []).map((r) => ({ ...r }));

  const prisma: any = {
    promoCode: {
      create: jest.fn(async ({ data }: any) => {
        if (promos.some((p) => p.code === data.code)) {
          const err: any = new Error('unique');
          err.code = 'P2002';
          throw err;
        }
        const row: PromoRow = {
          id: `p-${promos.length + 1}`,
          code: data.code,
          discountType: data.discountType,
          discountValue: data.discountValue,
          maxUses: data.maxUses ?? null,
          maxUsesPerUser: data.maxUsesPerUser ?? 1,
          expiresAt: data.expiresAt ?? null,
          coinPackIds: data.coinPackIds ?? [],
          enabled: true,
          createdBy: data.createdBy,
          notes: data.notes ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        promos.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id) return promos.find((p) => p.id === where.id) ?? null;
        if (where.code) return promos.find((p) => p.code === where.code) ?? null;
        return null;
      }),
      findMany: jest.fn(async ({ where, take, cursor, skip }: any) => {
        let pool = promos.slice();
        if (where?.enabled !== undefined) pool = pool.filter((p) => p.enabled === where.enabled);
        pool.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (cursor) {
          const idx = pool.findIndex((p) => p.id === cursor.id);
          if (idx >= 0) pool = pool.slice(idx + (skip ?? 0));
        }
        return pool.slice(0, take);
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const p = promos.find((x) => x.id === where.id);
        if (!p) throw new Error('no promo');
        Object.assign(p, data, { updatedAt: new Date() });
        return p;
      }),
    },
    promoCodeRedemption: {
      count: jest.fn(async ({ where }: any) =>
        redemptions.filter((r) =>
          (!where?.promoCodeId || r.promoCodeId === where.promoCodeId) &&
          (!where?.userId || r.userId === where.userId),
        ).length,
      ),
      create: jest.fn(async ({ data }: any) => {
        const row: RedemptionRow = {
          id: `r-${redemptions.length + 1}`,
          promoCodeId: data.promoCodeId,
          userId: data.userId,
          paymentOrderId: data.paymentOrderId ?? null,
          discountInr: data.discountInr,
          createdAt: new Date(),
        };
        redemptions.push(row);
        return row;
      }),
    },
  };
  const audit = { record: jest.fn(async () => undefined) };
  return {
    svc: new PromoCodesService(prisma, audit as any),
    prisma, audit,
    _promos: () => promos,
    _redemptions: () => redemptions,
  };
}

const ADMIN = { adminId: 'admin-1', adminEmail: 'admin@kalki.test' };

const basePromo: PromoRow = {
  id: 'p-1', code: 'KALKI50',
  discountType: PromoCodeDiscountType.PERCENT, discountValue: 50,
  maxUses: null, maxUsesPerUser: 1, expiresAt: null, coinPackIds: [],
  enabled: true, createdBy: 'admin-1', notes: null,
  createdAt: new Date(), updatedAt: new Date(),
};

describe('computeDiscount', () => {
  it('PERCENT floors to integer paise', () => {
    expect(computeDiscount({ discountType: PromoCodeDiscountType.PERCENT, discountValue: 25 }, 999)).toBe(249);
  });
  it('PERCENT 100% wipes the price', () => {
    expect(computeDiscount({ discountType: PromoCodeDiscountType.PERCENT, discountValue: 100 }, 50000)).toBe(50000);
  });
  it('FLAT caps at base price (no negative)', () => {
    expect(computeDiscount({ discountType: PromoCodeDiscountType.FLAT, discountValue: 60000 }, 50000)).toBe(50000);
  });
  it('FLAT under base price returns as-is', () => {
    expect(computeDiscount({ discountType: PromoCodeDiscountType.FLAT, discountValue: 1000 }, 5000)).toBe(1000);
  });
});

describe('PromoCodesService.create', () => {
  it('400s on bad code format', async () => {
    const { svc } = makeMocks();
    await expect(
      svc.create({ ...ADMIN, code: 'ab', discountType: PromoCodeDiscountType.PERCENT, discountValue: 10 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400s on PERCENT > 100', async () => {
    const { svc } = makeMocks();
    await expect(
      svc.create({ ...ADMIN, code: 'OK1234', discountType: PromoCodeDiscountType.PERCENT, discountValue: 200 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400s on non-positive FLAT', async () => {
    const { svc } = makeMocks();
    await expect(
      svc.create({ ...ADMIN, code: 'OK1234', discountType: PromoCodeDiscountType.FLAT, discountValue: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400s on past expiry', async () => {
    const { svc } = makeMocks();
    await expect(
      svc.create({
        ...ADMIN, code: 'OK1234',
        discountType: PromoCodeDiscountType.PERCENT, discountValue: 10,
        expiresAt: new Date(Date.now() - 1000),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('409s on duplicate code', async () => {
    const { svc } = makeMocks({ promos: [basePromo] });
    await expect(
      svc.create({ ...ADMIN, code: 'KALKI50', discountType: PromoCodeDiscountType.PERCENT, discountValue: 30 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('normalises code to uppercase, audits create', async () => {
    const { svc, audit, _promos } = makeMocks();
    await svc.create({
      ...ADMIN, code: 'newcode',
      discountType: PromoCodeDiscountType.PERCENT, discountValue: 25,
    });
    expect(_promos()[0].code).toBe('NEWCODE');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'promo.create' }));
  });
});

describe('PromoCodesService.validate', () => {
  it('rejects unknown code', async () => {
    const { svc } = makeMocks();
    const r = await svc.validate({ code: 'NOPE', userId: 'u-1', basePaise: 10000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('PROMO_NOT_FOUND');
  });

  it('rejects disabled code', async () => {
    const { svc } = makeMocks({ promos: [{ ...basePromo, enabled: false }] });
    const r = await svc.validate({ code: 'KALKI50', userId: 'u-1', basePaise: 10000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('PROMO_DISABLED');
  });

  it('rejects expired code', async () => {
    const { svc } = makeMocks({
      promos: [{ ...basePromo, expiresAt: new Date(Date.now() - 1000) }],
    });
    const r = await svc.validate({ code: 'KALKI50', userId: 'u-1', basePaise: 10000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('PROMO_EXPIRED');
  });

  it('rejects when coinPackId not in allowlist', async () => {
    const { svc } = makeMocks({
      promos: [{ ...basePromo, coinPackIds: ['premium-pack'] }],
    });
    const r = await svc.validate({ code: 'KALKI50', userId: 'u-1', coinPackId: 'starter-pack', basePaise: 10000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('PROMO_NOT_FOR_THIS_PACK');
  });

  it('rejects when out of total uses', async () => {
    const { svc } = makeMocks({
      promos: [{ ...basePromo, maxUses: 1 }],
      redemptions: [{
        id: 'r-prev', promoCodeId: 'p-1', userId: 'u-other',
        paymentOrderId: null, discountInr: 0, createdAt: new Date(),
      }],
    });
    const r = await svc.validate({ code: 'KALKI50', userId: 'u-1', basePaise: 10000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('PROMO_OUT_OF_USES');
  });

  it('rejects when user has hit per-user cap', async () => {
    const { svc } = makeMocks({
      promos: [{ ...basePromo, maxUsesPerUser: 1 }],
      redemptions: [{
        id: 'r-mine', promoCodeId: 'p-1', userId: 'u-1',
        paymentOrderId: null, discountInr: 0, createdAt: new Date(),
      }],
    });
    const r = await svc.validate({ code: 'KALKI50', userId: 'u-1', basePaise: 10000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('PROMO_USER_LIMIT_REACHED');
  });

  it('happy path returns discount + final amount', async () => {
    const { svc } = makeMocks({ promos: [basePromo] });
    const r = await svc.validate({ code: 'KALKI50', userId: 'u-1', basePaise: 50000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.discountInr).toBe(25000);
      expect(r.finalPaise).toBe(25000);
      expect(r.promoCodeId).toBe('p-1');
    }
  });

  it('rejects invalid base price', async () => {
    const { svc } = makeMocks({ promos: [basePromo] });
    const r = await svc.validate({ code: 'KALKI50', userId: 'u-1', basePaise: -100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('PROMO_BASE_PRICE_INVALID');
  });
});

describe('PromoCodesService.setEnabled', () => {
  it('idempotent when state unchanged', async () => {
    const { svc, audit } = makeMocks({ promos: [{ ...basePromo, enabled: true }] });
    await svc.setEnabled({ ...ADMIN, promoCodeId: 'p-1', enabled: true });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('writes audit on transition', async () => {
    const { svc, audit, _promos } = makeMocks({ promos: [{ ...basePromo, enabled: true }] });
    await svc.setEnabled({ ...ADMIN, promoCodeId: 'p-1', enabled: false });
    expect(_promos()[0].enabled).toBe(false);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'promo.disable' }));
  });
});

describe('PromoCodesService.redeem', () => {
  it('records the redemption row', async () => {
    const { svc, _redemptions } = makeMocks({ promos: [basePromo] });
    await svc.redeem({
      promoCodeId: 'p-1', userId: 'u-1',
      paymentOrderId: 'po-1', discountInr: 25000,
    });
    expect(_redemptions()).toHaveLength(1);
    expect(_redemptions()[0].discountInr).toBe(25000);
  });
});
