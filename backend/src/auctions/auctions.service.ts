import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { BidsService } from '../bids/bids.service';
import { BidEventsService } from '../bids/bid-events.service';
import { selectWinnerFromBids } from '../bids/bidding-engine';

@Injectable()
export class AuctionsService {
  private readonly logger = new Logger(AuctionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bids: BidsService,
    private readonly bidEvents: BidEventsService,
  ) {}

  /**
   * Return every auction with its winner info. The list is sorted client-side
   * via SQL: LIVE first (by endsAt asc, so the soonest-ending is on top),
   * then UPCOMING by startsAt asc, then ENDED by closedAt desc.
   */
  async list() {
    const rows = await this.prisma.auction.findMany({
      include: {
        winner: { select: { username: true } },
      },
    });

    const order: Record<string, number> = { LIVE: 0, UPCOMING: 1, ENDED: 2 };
    rows.sort((a, b) => {
      const diff = order[a.status] - order[b.status];
      if (diff !== 0) return diff;
      if (a.status === 'LIVE') return a.endsAt.getTime() - b.endsAt.getTime();
      if (a.status === 'UPCOMING') {
        const aStart = a.startsAt?.getTime() ?? a.createdAt.getTime();
        const bStart = b.startsAt?.getTime() ?? b.createdAt.getTime();
        return aStart - bStart;
      }
      // ENDED: most recently closed first
      const aClose = a.closedAt?.getTime() ?? 0;
      const bClose = b.closedAt?.getTime() ?? 0;
      return bClose - aClose;
    });
    return rows;
  }

  async get(id: string) {
    const a = await this.prisma.auction.findUnique({
      where: { id },
      include: { winner: { select: { username: true } } },
    });
    if (!a) throw new NotFoundException('auction not found');
    return a;
  }

  create(data: {
    title: string;
    description: string;
    imageUrls?: string[];
    retailPrice: string;
    coinsPerBid: number;
    startsAt?: Date | null;
    endsAt: Date;
  }) {
    // If startsAt is null OR in the past, the auction is LIVE immediately.
    // Otherwise it's UPCOMING and the scheduler will promote it.
    const startsAt = data.startsAt ?? null;
    const initialStatus =
      startsAt == null || startsAt.getTime() <= Date.now() ? 'LIVE' : 'UPCOMING';

    return this.prisma.auction.create({
      data: {
        title: data.title,
        description: data.description,
        imageUrls: data.imageUrls ?? [],
        retailPrice: data.retailPrice,
        coinsPerBid: data.coinsPerBid,
        startsAt,
        endsAt: data.endsAt,
        status: initialStatus,
      },
    });
  }

  async update(
    id: string,
    data: {
      title?: string;
      description?: string;
      imageUrls?: string[];
      retailPrice?: string;
      coinsPerBid?: number;
      startsAt?: Date | null;
      endsAt?: Date;
      manipulationMode?: 'NORMAL' | 'NO_WINNER' | 'FIXED_WINNER';
      /** String decimal (matches DTO) or null to clear. */
      fixedWinningAmount?: string | null;
    },
  ) {
    const existing = await this.prisma.auction.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('auction not found');
    if (existing.status === 'ENDED') {
      throw new NotFoundException('cannot edit an ended auction');
    }

    // Re-derive status if startsAt was supplied — if the new start time is
    // null or in the past, the auction is LIVE; otherwise UPCOMING. We never
    // touch the status of an auction whose startsAt isn't being changed.
    let nextStatus: 'LIVE' | 'UPCOMING' | undefined;
    if (Object.prototype.hasOwnProperty.call(data, 'startsAt')) {
      nextStatus =
        data.startsAt == null || data.startsAt.getTime() <= Date.now()
          ? 'LIVE'
          : 'UPCOMING';
    }

    // Manipulation-mode invariants. When the admin flips to FIXED_WINNER,
    // a `fixedWinningAmount` MUST be present (either in this patch or
    // already on the row). When they flip back to anything else, null out
    // the amount so a stale value doesn't leak into a re-enabled mode.
    let manipulationMode: 'NORMAL' | 'NO_WINNER' | 'FIXED_WINNER' | undefined;
    let fixedWinningAmount: string | null | undefined;
    if (data.manipulationMode !== undefined) {
      manipulationMode = data.manipulationMode;
      if (manipulationMode === 'FIXED_WINNER') {
        const incoming = data.fixedWinningAmount;
        const carried =
          existing.fixedWinningAmount?.toString() ?? null;
        const amount = incoming !== undefined ? incoming : carried;
        if (!amount) {
          throw new NotFoundException(
            'FIXED_WINNER mode requires `fixedWinningAmount` to be set',
          );
        }
        fixedWinningAmount = amount;
      } else {
        fixedWinningAmount = null;
      }
    } else if (Object.prototype.hasOwnProperty.call(data, 'fixedWinningAmount')) {
      // Admin updated only the amount (mode unchanged). Honour it as-is.
      fixedWinningAmount = data.fixedWinningAmount ?? null;
    }

    const updated = await this.prisma.auction.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.imageUrls !== undefined && { imageUrls: data.imageUrls }),
        ...(data.retailPrice !== undefined && { retailPrice: data.retailPrice }),
        ...(data.coinsPerBid !== undefined && { coinsPerBid: data.coinsPerBid }),
        ...(Object.prototype.hasOwnProperty.call(data, 'startsAt') && {
          startsAt: data.startsAt ?? null,
        }),
        ...(data.endsAt !== undefined && { endsAt: data.endsAt }),
        ...(nextStatus !== undefined && { status: nextStatus }),
        ...(manipulationMode !== undefined && { manipulationMode }),
        ...(fixedWinningAmount !== undefined && { fixedWinningAmount }),
      },
    });

    // Retroactive ringmaster backfill: when admin flips a LIVE auction
    // into NO_WINNER mid-stream, any already-placed LOWEST_UNIQUE bid
    // is "winning" until a new bid lands and the per-placement
    // collision in `BidsService.placeBid` kicks in. That leaves users
    // staring at a stale "you're winning" status for an indefinite
    // period. Cascade ringmaster collisions over the current pool so
    // every winning amount is neutralised right now, then broadcast a
    // bid event so connected WS subscribers receive the freshly
    // re-classified status.
    const flippedIntoNoWinner =
      existing.manipulationMode !== 'NO_WINNER' &&
      updated.manipulationMode === 'NO_WINNER' &&
      updated.status === 'LIVE';
    if (flippedIntoNoWinner) {
      try {
        const placed = await this.bids.cascadeRingmasterCollisions(updated.id);
        if (placed > 0) {
          // Empty userId is fine — gateway uses auctionId to enumerate
          // subscribers, the userId field on the event is only kept
          // for future per-user filtering.
          await this.bidEvents.broadcastBidPlaced(updated.id, '');
        }
      } catch (err) {
        // Don't fail the admin write because the cascade fell over —
        // the auction is already in NO_WINNER mode; the next real bid
        // will trigger the per-placement collision and self-heal.
        this.logger.error(
          `ringmaster backfill on auction ${updated.id} failed: ${(err as Error).message}`,
        );
      }
    }

    return updated;
  }

  async delete(id: string) {
    const existing = await this.prisma.auction.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('auction not found');
    // Bid rows cascade via the FK; no need to delete them separately.
    await this.prisma.auction.delete({ where: { id } });
    return { ok: true };
  }

  /** Force an UPCOMING auction LIVE immediately. No-op if already LIVE. */
  async startNow(id: string) {
    const existing = await this.prisma.auction.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('auction not found');
    if (existing.status === 'ENDED') {
      throw new NotFoundException('auction has already ended');
    }
    if (existing.status === 'LIVE') return existing;
    return this.prisma.auction.update({
      where: { id },
      data: { status: 'LIVE', startsAt: new Date() },
    });
  }

  /**
   * Move UPCOMING auctions whose startsAt has passed to LIVE. Called by the
   * scheduler every minute.
   */
  async promoteUpcomingToLive() {
    const now = new Date();
    const due = await this.prisma.auction.findMany({
      where: { status: 'UPCOMING', startsAt: { not: null, lte: now } },
      select: { id: true },
    });
    if (due.length === 0) return 0;
    const result = await this.prisma.auction.updateMany({
      where: { id: { in: due.map((a) => a.id) } },
      data: { status: 'LIVE' },
    });
    this.logger.log(`promoted ${result.count} auction(s) UPCOMING → LIVE`);
    return result.count;
  }

  /**
   * Close an auction: snapshot all bids, run the winner algorithm, persist
   * the result. Idempotent — returns the existing winner if already closed.
   *
   * Honours admin manipulation modes:
   *   - NORMAL        → lowest-unique-bid rule (default).
   *   - FIXED_WINNER  → earliest bidder at `fixedWinningAmount` wins.
   *   - NO_WINNER     → nobody wins. The kill-switch keeps the ringmaster
   *                     auto-colliding live, so the natural rule already
   *                     leaves the set without uniques; we additionally
   *                     short-circuit to null winner just in case the
   *                     auction was switched OFF before close.
   */
  async close(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const auction = await tx.auction.findUnique({ where: { id } });
      if (!auction) throw new NotFoundException('auction not found');
      if (auction.status === 'ENDED') return auction;

      const bids = await tx.bid.findMany({
        where: { auctionId: id },
        select: { id: true, userId: true, amount: true, createdAt: true },
      });

      let winner: { userId: string; amount: Decimal } | null = null;
      if (auction.manipulationMode !== 'NO_WINNER') {
        const richBids = bids.map((b) => ({
          id: b.id,
          userId: b.userId,
          amount: new Decimal(b.amount.toString()),
          createdAt: b.createdAt,
        }));
        winner = selectWinnerFromBids(richBids, {
          fixedWinningAmount:
            auction.manipulationMode === 'FIXED_WINNER' && auction.fixedWinningAmount
              ? new Decimal(auction.fixedWinningAmount.toString())
              : null,
        });
      }

      return tx.auction.update({
        where: { id },
        data: {
          status: 'ENDED',
          closedAt: new Date(),
          winnerId: winner?.userId ?? null,
          winnerAmount: winner ? winner.amount.toFixed(2) : null,
        },
      });
    });
  }
}
