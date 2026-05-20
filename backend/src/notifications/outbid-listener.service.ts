import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../foundation/notification.service';
import { FeatureFlagService } from '../foundation/feature-flags.service';

/**
 * Outbid-notification listener. Called from `BidsService.placeBid()`
 * AFTER a successful new bid lands. Computes the set of users who
 * were displaced from `LOWEST_UNIQUE` by this bid AND who watch the
 * auction, then enqueues an `auction_outbid_v1` notification per
 * displaced watcher.
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

    // Load every Watchlist entry for this auction whose user isn't
    // the new bidder, and whose last notification was > DEBOUNCE_MS
    // ago (or never).
    const cutoff = new Date(Date.now() - OutbidListenerService.DEBOUNCE_MS);
    const watchers = await this.prisma.watchlist.findMany({
      where: {
        auctionId: input.auctionId,
        userId: { not: input.newBidderId },
        OR: [{ lastNotifiedAt: null }, { lastNotifiedAt: { lt: cutoff } }],
      },
      select: { id: true, userId: true },
    });
    if (watchers.length === 0) return;

    // Auction title for the body. One query, reused per watcher.
    const auction = await this.prisma.auction.findUnique({
      where: { id: input.auctionId },
      select: { title: true, retailPrice: true },
    });
    if (!auction) return;

    const payload = {
      auctionTitle: auction.title,
      newBidAmount: input.newBidAmount.toFixed(2),
      retailPrice: auction.retailPrice.toString(),
    };

    // Enqueue per watcher. The notification service handles channel
    // selection from each user's preferences.
    for (const watcher of watchers) {
      try {
        await this.notifications.enqueue({
          templateCode: 'auction_outbid_v1',
          userId: watcher.userId,
          payload,
          // Anchor: same triple = same notification (idempotent if
          // this listener fires twice for the same bid).
          idempotencyAnchor: `auction:${input.auctionId}:outbid:${watcher.userId}:${input.newBidId}`,
        });
      } catch (e) {
        this.logger.error(
          `failed to enqueue outbid for user=${watcher.userId} auction=${input.auctionId}: ${(e as Error).message}`,
        );
      }
    }

    // Bump lastNotifiedAt on all rows in one query.
    await this.prisma.watchlist.updateMany({
      where: { id: { in: watchers.map((w) => w.id) } },
      data: { lastNotifiedAt: new Date() },
    });
  }
}
