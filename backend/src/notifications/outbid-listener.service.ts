import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../foundation/notification.service';
import { FeatureFlagService } from '../foundation/feature-flags.service';
// Pure functions only — importing the bidding-engine module does NOT pull
// in BidsModule/BidsService, so there is no DI cycle with the bids module
// that calls us back via `onBidPlaced`.
import {
  classifyOptsFromAuction,
  selectWinnerFromBids,
  type BidRow,
} from '../bids/bidding-engine';

/**
 * Outbid-notification listener. Called from `BidsService.placeBid()`
 * AFTER a successful new bid lands. Finds the user (if any) who was
 * displaced from `LOWEST_UNIQUE` by this bid AND who watches the
 * auction, then enqueues a single `auction_outbid_v1` notification.
 *
 * Only the prior winner can be "outbid": a lowest-unique auction has
 * at most ONE winning bid at any instant, so a new bid can displace at
 * most one user. We therefore compare the winning bid *before* the new
 * bid against the winning bid *after* it (using the same
 * `selectWinnerFromBids` the auction-close path uses) and notify only
 * the user who lost the winning position — NOT every watcher. (The
 * previous implementation notified every watcher of the auction, which
 * contradicted this very docstring and spammed losing bidders.)
 *
 * Why this lives in `notifications/` (not `bids/`):
 *
 *   - The notification concern is one-way coupled to bidding (bids
 *     don't depend on notifications). Keeping the listener in the
 *     notifications module means a future refactor that adds a
 *     similar "aviator-cashout-leaderboard-displaced" event reuses
 *     the same module structure.
 *
 *   - Feature-flag gating happens here once; the bids service
 *     doesn't need to know about flags.
 *
 *   - The hook is idempotent. The same physical bid getting
 *     re-processed (e.g. retry) produces the same notifications
 *     (de-duped by the
 *     `auction:{auctionId}:outbid:{displacedUserId}:{newBidId}`
 *     idempotency anchor).
 *
 * Spam control:
 *
 *   - Per-user, per-auction debounce: one outbid notification per
 *     60 seconds. Stored on `Watchlist.lastNotifiedAt`.
 *
 *   - The user who just placed the bid never gets notified of their
 *     own displacement.
 */
@Injectable()
export class OutbidListenerService {
  private readonly logger = new Logger(OutbidListenerService.name);
  private static readonly DEBOUNCE_MS = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly flags: FeatureFlagService,
  ) {}

  /**
   * Fire from `BidsService.placeBid()` after the new bid is
   * persisted and the wallet debit has settled. Safe to invoke
   * inside a try/catch — the bid placement should never fail
   * because outbid notifications failed.
   */
  async onBidPlaced(input: {
    auctionId: string;
    newBidderId: string;
    newBidId: string;
    newBidAmount: Decimal;
  }): Promise<void> {
    if (!(await this.flags.isEnabled('watchlist.outbid_notifications'))) {
      return;
    }

    // Auction row: title/retailPrice for the body; manipulationMode +
    // fixedWinningAmount to build the same ClassifyOpts the bidding
    // engine uses everywhere else (so FIXED_WINNER auctions resolve the
    // winner identically here and at close time).
    const auction = await this.prisma.auction.findUnique({
      where: { id: input.auctionId },
      select: {
        title: true,
        retailPrice: true,
        manipulationMode: true,
        fixedWinningAmount: true,
      },
    });
    if (!auction) return;

    const opts = classifyOptsFromAuction(auction);

    // Every bid on the auction. The new bid is already persisted (we run
    // after the commit), so it is in this set; we recover the "before"
    // set by filtering it out. Winner-before ≠ winner-after ⇒ the
    // before-winner was displaced.
    const allBids: BidRow[] = (
      await this.prisma.bid.findMany({
        where: { auctionId: input.auctionId },
        select: { id: true, userId: true, amount: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      })
    ).map((b) => ({
      id: b.id,
      userId: b.userId,
      amount: new Decimal(b.amount.toString()),
      createdAt: b.createdAt,
    }));

    const beforeBids = allBids.filter((b) => b.id !== input.newBidId);
    const beforeWinner = selectWinnerFromBids(beforeBids, opts);
    // No prior winner ⇒ nobody was displaced. (The new bid may have just
    // created the first-ever winner — that is not an "outbid" event.)
    if (!beforeWinner) return;

    const afterWinner = selectWinnerFromBids(allBids, opts);
    // Prior winner kept the position (e.g. the new bid was a higher
    // unique-losing amount) ⇒ no displacement.
    if (afterWinner && afterWinner.userId === beforeWinner.userId) return;

    const displacedUserId = beforeWinner.userId;
    // The new bidder is never notified of "their own" displacement. (The
    // re-bid guard already blocks the current winner from re-bidding, so
    // this is belt-and-suspenders.)
    if (displacedUserId === input.newBidderId) return;

    // Notify only if the displaced user actually watches the auction and
    // isn't inside the per-user debounce window.
    const cutoff = new Date(Date.now() - OutbidListenerService.DEBOUNCE_MS);
    const watch = await this.prisma.watchlist.findFirst({
      where: {
        auctionId: input.auctionId,
        userId: displacedUserId,
        OR: [{ lastNotifiedAt: null }, { lastNotifiedAt: { lt: cutoff } }],
      },
      select: { id: true },
    });
    if (!watch) return;

    const payload = {
      auctionTitle: auction.title,
      newBidAmount: input.newBidAmount.toFixed(2),
      retailPrice: auction.retailPrice.toString(),
    };

    try {
      await this.notifications.enqueue({
        templateCode: 'auction_outbid_v1',
        userId: displacedUserId,
        payload,
        // Anchor: same (auction, displaced user, triggering bid) = same
        // notification (idempotent if this listener fires twice for the
        // same bid).
        idempotencyAnchor: `auction:${input.auctionId}:outbid:${displacedUserId}:${input.newBidId}`,
      });
    } catch (e) {
      this.logger.error(
        `failed to enqueue outbid for user=${displacedUserId} auction=${input.auctionId}: ${(e as Error).message}`,
      );
      // Don't start the debounce window when the enqueue failed — let the
      // next bid retry the notification.
      return;
    }

    await this.prisma.watchlist.update({
      where: { id: watch.id },
      data: { lastNotifiedAt: new Date() },
    });
  }
}
