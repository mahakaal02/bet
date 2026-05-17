import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AuctionsService } from './auctions.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Runs every minute. Finds LIVE auctions whose `endsAt` has passed and closes
 * them via `AuctionsService.close` — that snapshots bids, picks a winner, and
 * marks the auction ENDED. A Redis advisory lock ensures only one instance
 * closes each auction even if the backend is horizontally scaled.
 */
@Injectable()
export class AuctionScheduler {
  private readonly logger = new Logger(AuctionScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly auctions: AuctionsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Move UPCOMING auctions whose start time has passed to LIVE. */
  @Cron(CronExpression.EVERY_MINUTE)
  async promoteUpcoming() {
    await this.redis.withLock('auction-promote', 5_000, async () => {
      await this.auctions.promoteUpcomingToLive();
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async closeExpired() {
    const expired = await this.prisma.auction.findMany({
      where: { status: 'LIVE', endsAt: { lte: new Date() } },
      select: { id: true },
    });
    if (expired.length === 0) return;

    for (const { id } of expired) {
      await this.redis.withLock(`auction-close:${id}`, 10_000, async () => {
        const result = await this.auctions.close(id);
        this.logger.log(`closed auction ${id} → winner=${result.winnerId ?? 'none'}`);
        if (result.winnerId) {
          await this.notifications.notifyUser(result.winnerId, {
            title: 'You won an auction!',
            body: `Your winning bid was ₹${result.winnerAmount?.toString() ?? '?'}.`,
            data: { auctionId: id, kind: 'winner' },
          });
        }
      });
    }
  }
}
