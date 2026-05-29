import Decimal from 'decimal.js';
import { OutbidListenerService } from './outbid-listener.service';

/**
 * Outbid-listener unit tests.
 *
 * The single behaviour under test is the bug fix: only the user who was
 * displaced from the LOWEST_UNIQUE position by the new bid is notified —
 * NOT every watcher of the auction. A lowest-unique auction has at most
 * one winning bid at a time, so at most one user is ever notified.
 */
describe('OutbidListenerService', () => {
  type MockBid = { id: string; userId: string; amount: string; createdAt: Date };

  function build(opts: {
    bids: MockBid[];
    flagOn?: boolean;
    manipulationMode?: string;
    fixedWinningAmount?: string | null;
    // userId -> watchlist row (or null when not watching / debounced)
    watch?: (userId: string) => { id: string } | null;
  }) {
    const enqueue = jest.fn(async (_input: any) => undefined);
    const updateWatch = jest.fn(async (_args: any) => undefined);
    const findFirstWatch = jest.fn(async ({ where }: any) =>
      (opts.watch ?? (() => ({ id: `w-${where.userId}` })))(where.userId),
    );
    const auctionFindUnique = jest.fn(async () => ({
      title: 'Sneakers',
      retailPrice: '199.99',
      manipulationMode: opts.manipulationMode ?? 'NORMAL',
      fixedWinningAmount: opts.fixedWinningAmount ?? null,
    }));
    const bidFindMany = jest.fn(async () => opts.bids);

    const prisma = {
      auction: { findUnique: auctionFindUnique },
      bid: { findMany: bidFindMany },
      watchlist: { findFirst: findFirstWatch, update: updateWatch },
    } as any;
    const notifications = { enqueue } as any;
    const flags = { isEnabled: jest.fn(async () => opts.flagOn ?? true) } as any;

    const svc = new OutbidListenerService(prisma, notifications, flags);
    return { svc, enqueue, updateWatch, findFirstWatch, auctionFindUnique };
  }

  const at = (ms: number) => new Date(2026, 0, 1, 0, 0, 0, ms);

  it('notifies ONLY the displaced prior winner — not other losing watchers', async () => {
    // Before: A=5 is lowest-unique (winning), C=8 is unique-losing.
    // New bid: B=3 undercuts → B becomes the new winner, A is displaced.
    const { svc, enqueue, findFirstWatch, updateWatch } = build({
      bids: [
        { id: 'bidA', userId: 'A', amount: '5', createdAt: at(0) },
        { id: 'bidC', userId: 'C', amount: '8', createdAt: at(1) },
        { id: 'bidB', userId: 'B', amount: '3', createdAt: at(2) },
      ],
    });

    await svc.onBidPlaced({
      auctionId: 'auc1',
      newBidderId: 'B',
      newBidId: 'bidB',
      newBidAmount: new Decimal('3'),
    });

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toMatchObject({
      templateCode: 'auction_outbid_v1',
      userId: 'A',
      idempotencyAnchor: 'auction:auc1:outbid:A:bidB',
    });
    // Only the displaced user A was looked up — C (a watcher who was
    // already losing) is never queried, so never notified.
    expect(findFirstWatch).toHaveBeenCalledTimes(1);
    expect(findFirstWatch.mock.calls[0][0].where.userId).toBe('A');
    expect(updateWatch).toHaveBeenCalledTimes(1);
  });

  it('does not notify when the new bid is a higher losing bid (winner unchanged)', async () => {
    // A=5 stays the winner; B=10 is just another losing bid.
    const { svc, enqueue, updateWatch } = build({
      bids: [
        { id: 'bidA', userId: 'A', amount: '5', createdAt: at(0) },
        { id: 'bidB', userId: 'B', amount: '10', createdAt: at(1) },
      ],
    });

    await svc.onBidPlaced({
      auctionId: 'auc1',
      newBidderId: 'B',
      newBidId: 'bidB',
      newBidAmount: new Decimal('10'),
    });

    expect(enqueue).not.toHaveBeenCalled();
    expect(updateWatch).not.toHaveBeenCalled();
  });

  it('does not notify when there was no prior winner (first winner is not an outbid)', async () => {
    // Before: A=5, C=5 collide → no unique winner. New bid B=3 creates the
    // first-ever winner, which must NOT fire an outbid notification.
    const { svc, enqueue } = build({
      bids: [
        { id: 'bidA', userId: 'A', amount: '5', createdAt: at(0) },
        { id: 'bidC', userId: 'C', amount: '5', createdAt: at(1) },
        { id: 'bidB', userId: 'B', amount: '3', createdAt: at(2) },
      ],
    });

    await svc.onBidPlaced({
      auctionId: 'auc1',
      newBidderId: 'B',
      newBidId: 'bidB',
      newBidAmount: new Decimal('3'),
    });

    expect(enqueue).not.toHaveBeenCalled();
  });

  it('never notifies the new bidder for their own displacement', async () => {
    // A=5 winning; A re-bids 5 (collides with itself) → 5 no longer unique,
    // so A loses the position — but A is the bidder, so no self-notify.
    const { svc, enqueue } = build({
      bids: [
        { id: 'bidA1', userId: 'A', amount: '5', createdAt: at(0) },
        { id: 'bidA2', userId: 'A', amount: '5', createdAt: at(1) },
      ],
    });

    await svc.onBidPlaced({
      auctionId: 'auc1',
      newBidderId: 'A',
      newBidId: 'bidA2',
      newBidAmount: new Decimal('5'),
    });

    expect(enqueue).not.toHaveBeenCalled();
  });

  it('respects debounce / not-watching: no enqueue when watchlist lookup is empty', async () => {
    const { svc, enqueue, updateWatch } = build({
      bids: [
        { id: 'bidA', userId: 'A', amount: '5', createdAt: at(0) },
        { id: 'bidB', userId: 'B', amount: '3', createdAt: at(1) },
      ],
      watch: () => null, // displaced user is debounced or not watching
    });

    await svc.onBidPlaced({
      auctionId: 'auc1',
      newBidderId: 'B',
      newBidId: 'bidB',
      newBidAmount: new Decimal('3'),
    });

    expect(enqueue).not.toHaveBeenCalled();
    expect(updateWatch).not.toHaveBeenCalled();
  });

  it('no-ops without touching the DB when the feature flag is off', async () => {
    const { svc, enqueue, auctionFindUnique } = build({
      bids: [],
      flagOn: false,
    });

    await svc.onBidPlaced({
      auctionId: 'auc1',
      newBidderId: 'B',
      newBidId: 'bidB',
      newBidAmount: new Decimal('3'),
    });

    expect(auctionFindUnique).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
