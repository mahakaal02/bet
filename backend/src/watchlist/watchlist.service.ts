import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagService } from '../foundation/feature-flags.service';

/**
 * Watchlist service — backs the "★ Watch" affordance on auction
 * tiles + the "My watchlist" page (Roadmap §F-USER-1).
 *
 * The schema for `Watchlist` already shipped in the Foundation PR,
 * and the outbid listener (`notifications/outbid-listener.service.ts`)
 * already reads from it to dispatch `auction_outbid_v1` notifications.
 * This service is the WRITE side — it lets users actually populate
 * the table.
 *
 * Gating: everything routes through the `watchlist.enabled` feature
 * flag. While the flag is OFF the controller surface 403s, so we can
 * canary-roll watchlist via the admin Feature Flags UI (PR-SETTINGS-1)
 * — same kill-switch shape as every other PR-* business feature.
 *
 * Rate / cap controls:
 *   - 200 watchlist entries per user (Roadmap target).
 *   - The notification dispatch per-auction rate-limit (1/min, 5/day)
 *     lives in the outbid listener, not here.
 *
 * Idempotency:
 *   - `watch()` is upsert-shaped so a double-tap doesn't 409. We
 *     return the existing row's `createdAt` if it was already
 *     present.
 *   - `unwatch()` is `deleteMany` so calling it twice is a no-op
 *     (returns `removed: 0` on the second call, not 404).
 */
@Injectable()
export class WatchlistService {
  private readonly logger = new Logger(WatchlistService.name);
  static readonly MAX_ENTRIES_PER_USER = 200;

  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: FeatureFlagService,
  ) {}

  async watch(userId: string, auctionId: string) {
    await this.requireEnabled();
    await this.requireAuctionExists(auctionId);

    // Cap check is done by `count` rather than a sentinel row so the
    // limit can be raised by changing the constant — no migration.
    const existing = await this.prisma.watchlist.findUnique({
      where: { userId_auctionId: { userId, auctionId } },
      select: { id: true, createdAt: true },
    });
    if (!existing) {
      const count = await this.prisma.watchlist.count({ where: { userId } });
      if (count >= WatchlistService.MAX_ENTRIES_PER_USER) {
        throw new BadRequestException(
          `watchlist is full (max ${WatchlistService.MAX_ENTRIES_PER_USER}) — unwatch something first`,
        );
      }
    }

    const row = await this.prisma.watchlist.upsert({
      where: { userId_auctionId: { userId, auctionId } },
      update: {},                                    // no-op on duplicate
      create: { userId, auctionId },
      select: { id: true, createdAt: true },
    });
    return {
      watching: true,
      since: row.createdAt.toISOString(),
      alreadyWatching: !!existing,
    };
  }

  async unwatch(userId: string, auctionId: string) {
    await this.requireEnabled();
    const result = await this.prisma.watchlist.deleteMany({
      where: { userId, auctionId },
    });
    return { watching: false, removed: result.count };
  }

  /** Cheap one-shot check used by the auction detail page. */
  async isWatching(userId: string, auctionId: string): Promise<boolean> {
    await this.requireEnabled();
    const row = await this.prisma.watchlist.findUnique({
      where: { userId_auctionId: { userId, auctionId } },
      select: { id: true },
    });
    return !!row;
  }

  /**
   * "My watchlist" list. Sort: live auctions first (ending-soonest),
   * then upcoming (starting-soonest), then ended. Matches the user
   * mental model — "what should I act on right now?".
   *
   * Returns shallow auction projections — the watchlist page doesn't
   * need bid history, just the headline fields. Image URLs come
   * straight from `Auction.imageUrls[0]` (the cover image).
   */
  async listForUser(userId: string) {
    await this.requireEnabled();
    const rows = await this.prisma.watchlist.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        lastNotifiedAt: true,
        auction: {
          select: {
            id: true,
            title: true,
            description: true,
            imageUrls: true,
            status: true,
            startsAt: true,
            endsAt: true,
            coinsPerBid: true,
            retailPrice: true,
          },
        },
      },
    });

    // Bucket + sort.
    const live = rows.filter((r) => r.auction.status === 'LIVE');
    const upcoming = rows.filter((r) => r.auction.status === 'UPCOMING');
    const other = rows.filter(
      (r) => r.auction.status !== 'LIVE' && r.auction.status !== 'UPCOMING',
    );

    live.sort(
      (a, b) =>
        (a.auction.endsAt?.getTime() ?? Infinity) -
        (b.auction.endsAt?.getTime() ?? Infinity),
    );
    upcoming.sort(
      (a, b) =>
        (a.auction.startsAt?.getTime() ?? Infinity) -
        (b.auction.startsAt?.getTime() ?? Infinity),
    );
    other.sort(
      (a, b) =>
        (b.auction.endsAt?.getTime() ?? 0) -
        (a.auction.endsAt?.getTime() ?? 0),
    );

    return {
      items: [...live, ...upcoming, ...other].map((r) => ({
        id: r.id,
        watchedAt: r.createdAt.toISOString(),
        lastNotifiedAt: r.lastNotifiedAt?.toISOString() ?? null,
        auction: {
          id: r.auction.id,
          title: r.auction.title,
          description: r.auction.description,
          imageUrl: r.auction.imageUrls[0] ?? null,
          status: r.auction.status,
          startsAt: r.auction.startsAt?.toISOString() ?? null,
          endsAt: r.auction.endsAt?.toISOString() ?? null,
          coinsPerBid: r.auction.coinsPerBid,
          retailPrice: r.auction.retailPrice.toString(),
        },
      })),
      counts: {
        live: live.length,
        upcoming: upcoming.length,
        other: other.length,
        total: rows.length,
        cap: WatchlistService.MAX_ENTRIES_PER_USER,
      },
    };
  }

  private async requireEnabled() {
    if (!(await this.flags.isEnabled('watchlist.enabled'))) {
      throw new ForbiddenException('watchlist feature is not enabled yet');
    }
  }

  private async requireAuctionExists(auctionId: string) {
    const row = await this.prisma.auction.findUnique({
      where: { id: auctionId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('auction not found');
  }
}
