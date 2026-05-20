import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { WatchlistService } from './watchlist.service';

/**
 * Service tests for the watchlist write side. Covers:
 *
 *   1. Feature-flag gating — `watchlist.enabled` OFF ⇒ 403 on every
 *      method.
 *   2. Auction existence — `watch()` of an unknown id ⇒ 404.
 *   3. Idempotency — `watch()` twice does NOT 409 (returns
 *      `alreadyWatching: true`); `unwatch()` twice returns
 *      `removed: 0` on the second call.
 *   4. Cap — 200 entries per user. A 201st `watch()` is rejected
 *      with 400 *unless* it's a re-watch of an existing row.
 *   5. Listing — buckets/sorts: LIVE first, ending-soonest;
 *      UPCOMING next, starting-soonest; then anything else.
 */

function makeFlagsMock(enabled = true) {
  return { isEnabled: jest.fn(async () => enabled) };
}

function makePrismaMock(opts: {
  auctionExists?: boolean;
  existingRow?: { id: string; createdAt: Date } | null;
  count?: number;
  listRows?: any[];
  deletedCount?: number;
} = {}) {
  const upsertedRows = new Map<string, any>();
  return {
    auction: {
      findUnique: jest.fn(async () =>
        opts.auctionExists === false ? null : { id: 'a-1' },
      ),
    },
    watchlist: {
      findUnique: jest.fn(async ({ where }: any) =>
        opts.existingRow ?? upsertedRows.get(JSON.stringify(where)) ?? null,
      ),
      count: jest.fn(async () => opts.count ?? 0),
      upsert: jest.fn(async ({ where, create }: any) => {
        const key = JSON.stringify(where);
        if (!upsertedRows.has(key)) {
          upsertedRows.set(key, {
            id: 'row-1',
            createdAt: opts.existingRow?.createdAt ?? new Date(),
            ...create,
          });
        }
        return upsertedRows.get(key);
      }),
      deleteMany: jest.fn(async () => ({ count: opts.deletedCount ?? 1 })),
      findMany: jest.fn(async () => opts.listRows ?? []),
    },
    _upserted: upsertedRows,
  };
}

function makeService(opts: Parameters<typeof makePrismaMock>[0] = {}, enabled = true) {
  const prisma = makePrismaMock(opts);
  const flags = makeFlagsMock(enabled);
  return {
    svc: new WatchlistService(prisma as any, flags as any),
    prisma,
    flags,
  };
}

describe('WatchlistService — flag gating', () => {
  it('watch() throws 403 when watchlist.enabled is OFF', async () => {
    const { svc } = makeService({}, false);
    await expect(svc.watch('u-1', 'a-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('unwatch() throws 403 when watchlist.enabled is OFF', async () => {
    const { svc } = makeService({}, false);
    await expect(svc.unwatch('u-1', 'a-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('listForUser() throws 403 when watchlist.enabled is OFF', async () => {
    const { svc } = makeService({}, false);
    await expect(svc.listForUser('u-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('WatchlistService.watch', () => {
  it('404s on unknown auction', async () => {
    const { svc } = makeService({ auctionExists: false });
    await expect(svc.watch('u-1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('idempotent — watching twice does not 409', async () => {
    const { svc, prisma } = makeService({
      auctionExists: true,
      existingRow: { id: 'r-1', createdAt: new Date('2026-04-01') },
    });
    const res = await svc.watch('u-1', 'a-1');
    expect(res.watching).toBe(true);
    expect(res.alreadyWatching).toBe(true);
    // upsert is called; the no-op `update: {}` keeps the existing row.
    expect(prisma.watchlist.upsert).toHaveBeenCalledTimes(1);
  });

  it('rejects with 400 when the per-user cap is reached', async () => {
    const { svc } = makeService({
      auctionExists: true,
      existingRow: null,
      count: WatchlistService.MAX_ENTRIES_PER_USER,
    });
    await expect(svc.watch('u-1', 'a-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('still allows re-watching when the user is already at the cap', async () => {
    // The cap blocks *new* entries — if the row already exists for
    // this auction, watching it again is idempotent regardless of cap.
    const { svc } = makeService({
      auctionExists: true,
      existingRow: { id: 'r-1', createdAt: new Date() },
      count: WatchlistService.MAX_ENTRIES_PER_USER,
    });
    const res = await svc.watch('u-1', 'a-1');
    expect(res.watching).toBe(true);
  });
});

describe('WatchlistService.unwatch', () => {
  it('reports `removed: 0` on the second call (no 404)', async () => {
    const { svc } = makeService({ deletedCount: 0 });
    const res = await svc.unwatch('u-1', 'a-1');
    expect(res).toEqual({ watching: false, removed: 0 });
  });

  it('reports `removed: 1` on the first call', async () => {
    const { svc } = makeService({ deletedCount: 1 });
    const res = await svc.unwatch('u-1', 'a-1');
    expect(res.removed).toBe(1);
  });
});

describe('WatchlistService.listForUser', () => {
  const rowFor = (status: string, endsAt: Date, startsAt = new Date(0)) => ({
    id: `r-${status}-${endsAt.getTime()}`,
    createdAt: new Date(),
    lastNotifiedAt: null,
    auction: {
      id: `a-${status}-${endsAt.getTime()}`,
      title: `Auction ${status}`,
      description: 'x',
      imageUrls: ['https://cdn/x.png'],
      status,
      startsAt,
      endsAt,
      coinsPerBid: 10,
      retailPrice: { toString: () => '999.00' },
    },
  });

  it('buckets LIVE → UPCOMING → other, sorting LIVE ending-soonest', async () => {
    const liveLater = rowFor('LIVE', new Date('2026-06-01'));
    const liveSooner = rowFor('LIVE', new Date('2026-05-21'));
    const upcoming = rowFor(
      'UPCOMING',
      new Date('2026-07-01'),
      new Date('2026-05-25'),
    );
    const ended = rowFor('ENDED', new Date('2026-04-30'));
    const { svc } = makeService({
      listRows: [liveLater, ended, liveSooner, upcoming],
    });
    const res = await svc.listForUser('u-1');
    expect(res.items.map((i) => i.auction.id)).toEqual([
      liveSooner.auction.id,
      liveLater.auction.id,
      upcoming.auction.id,
      ended.auction.id,
    ]);
    expect(res.counts).toEqual({
      live: 2,
      upcoming: 1,
      other: 1,
      total: 4,
      cap: WatchlistService.MAX_ENTRIES_PER_USER,
    });
  });

  it('returns an empty list cleanly', async () => {
    const { svc } = makeService({ listRows: [] });
    const res = await svc.listForUser('u-1');
    expect(res.items).toEqual([]);
    expect(res.counts.total).toBe(0);
  });
});
