import { BadRequestException } from '@nestjs/common';
import { CsvImportService } from './csv-import.service';

interface CoinPackRow {
  id?: string;
  coins: number;
  priceInr: { toFixed: () => string; toString: () => string } | number;
  active: boolean;
  sortOrder: number;
}

function makeMocks() {
  const coinPacks: any[] = [];
  const auctions: any[] = [];
  const txCalls: string[] = [];

  const prisma: any = {
    coinPack: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        txCalls.push('upsert');
        const existing = coinPacks.find((p) => p.id === where.id);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        coinPacks.push({ id: where.id, ...create });
        return coinPacks[coinPacks.length - 1];
      }),
      create: jest.fn(async ({ data }: any) => {
        txCalls.push('create');
        const row = { id: `cp-${coinPacks.length + 1}`, ...data };
        coinPacks.push(row);
        return row;
      }),
    },
    auction: {
      create: jest.fn(async ({ data }: any) => {
        txCalls.push('auction.create');
        const row = { id: `a-${auctions.length + 1}`, ...data };
        auctions.push(row);
        return row;
      }),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };
  const audit = { record: jest.fn(async () => undefined) };
  return {
    svc: new CsvImportService(prisma, audit as any),
    prisma, audit,
    _coinPacks: () => coinPacks,
    _auctions: () => auctions,
    _txCalls: () => txCalls,
  };
}

const ADMIN = { adminId: 'admin-1', adminEmail: 'admin@kalki.test' };

describe('CsvImportService.importCoinPacks', () => {
  it('rejects missing header columns', async () => {
    const { svc } = makeMocks();
    await expect(
      svc.importCoinPacks({
        ...ADMIN,
        csvText: 'name,price\nfoo,10',
        dryRun: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('dry-run returns per-row validation, writes nothing', async () => {
    const { svc, _coinPacks } = makeMocks();
    const summary = await svc.importCoinPacks({
      ...ADMIN,
      csvText: 'coins,priceInr\n100,99\n500,449',
      dryRun: true,
    });
    expect(summary.dryRun).toBe(true);
    expect(summary.totalRows).toBe(2);
    expect(summary.okRows).toBe(2);
    expect(_coinPacks()).toHaveLength(0);
  });

  it('catches negative coins / non-integer / bad bool', async () => {
    const { svc } = makeMocks();
    const summary = await svc.importCoinPacks({
      ...ADMIN,
      csvText: 'coins,priceInr,active\n-5,10,yes\n3.5,10,true\n10,0,true',
      dryRun: true,
    });
    expect(summary.errorRows).toBe(3);
    expect(summary.rows[0].errors).toContain('coins must be a positive integer (got -5)');
    expect(summary.rows[1].errors?.[0]).toMatch(/coins/);
    expect(summary.rows[2].errors?.[0]).toMatch(/priceInr/);
  });

  it('refuses to commit when any row fails — even if dryRun=false', async () => {
    const { svc, _coinPacks } = makeMocks();
    const summary = await svc.importCoinPacks({
      ...ADMIN,
      csvText: 'coins,priceInr\n100,99\nbad,99',
      dryRun: false,
    });
    expect(summary.errorRows).toBe(1);
    // The result is still presented in "dry-run" shape so the UI tells
    // the operator nothing was written.
    expect(summary.dryRun).toBe(true);
    expect(_coinPacks()).toHaveLength(0);
  });

  it('commit writes + audits when all rows pass', async () => {
    const { svc, audit, _coinPacks } = makeMocks();
    const summary = await svc.importCoinPacks({
      ...ADMIN,
      csvText: 'coins,priceInr,active,sortOrder\n100,99,true,1\n500,449,true,2',
      dryRun: false,
    });
    expect(summary.okRows).toBe(2);
    expect(summary.dryRun).toBe(false);
    expect(_coinPacks()).toHaveLength(2);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'csv.import', targetType: 'CoinPack' }),
    );
  });

  it('upserts when id provided', async () => {
    const { svc, prisma } = makeMocks();
    await svc.importCoinPacks({
      ...ADMIN,
      csvText: 'id,coins,priceInr\nexisting-id,100,99',
      dryRun: false,
    });
    expect(prisma.coinPack.upsert).toHaveBeenCalled();
  });
});

describe('CsvImportService.importAuctions', () => {
  it('validates ISO dates + ordering', async () => {
    const { svc } = makeMocks();
    const summary = await svc.importAuctions({
      ...ADMIN,
      csvText:
        'title,description,retailPrice,coinsPerBid,endsAtIso,startsAtIso\n' +
        'Valid Title,A long enough description,12999,1,2026-12-31T23:59:00Z,2027-01-01T00:00:00Z',
      dryRun: true,
    });
    expect(summary.errorRows).toBe(1);
    expect(summary.rows[0].errors?.some((e) => /endsAtIso must be after startsAtIso/.test(e))).toBe(true);
  });

  it('accepts a minimum valid auction', async () => {
    const { svc } = makeMocks();
    const summary = await svc.importAuctions({
      ...ADMIN,
      csvText:
        'title,description,retailPrice,coinsPerBid,endsAtIso\n' +
        'Cool Watch,A premium chronograph wristwatch,12999,1,2026-12-31T23:59:00Z',
      dryRun: true,
    });
    expect(summary.okRows).toBe(1);
  });

  it('commits + audits', async () => {
    const { svc, audit, _auctions } = makeMocks();
    await svc.importAuctions({
      ...ADMIN,
      csvText:
        'title,description,retailPrice,coinsPerBid,endsAtIso\n' +
        'Cool Watch,A premium chronograph wristwatch,12999,1,2026-12-31T23:59:00Z',
      dryRun: false,
    });
    expect(_auctions()).toHaveLength(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'csv.import', targetType: 'Auction' }),
    );
  });

  it('rejects on empty CSV', async () => {
    const { svc } = makeMocks();
    await expect(
      svc.importAuctions({
        ...ADMIN,
        csvText: 'title,description,retailPrice,coinsPerBid,endsAtIso\n',
        dryRun: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
