import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { OutboxKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BetWalletService } from '../bet-wallet/bet-wallet.service';
import { OutboxService } from '../foundation/outbox.service';
import { FeatureFlagService } from '../foundation/feature-flags.service';
import { OutbidListenerService } from '../notifications/outbid-listener.service';
import { ResponsibleGamblingService } from '../responsible-gambling/responsible-gambling.service';
import { FraudService } from '../fraud/fraud.service';
import {
  type BidRow,
  type ClassifyOpts,
  classifyBidFor,
  classifyOptsFromAuction,
  classifyPlacedAmount,
} from './bidding-engine';

/** Email + username of the system-owned sentinel user that auto-collides
 *  winning bids when an auction is in NO_WINNER manipulation mode. */
const RINGMASTER_EMAIL = 'ringmaster@uniquebid.local';
const RINGMASTER_USERNAME = 'ringmaster';

@Injectable()
export class BidsService {
  private readonly logger = new Logger(BidsService.name);
  /** Cache once per process — the row is stable, only created at most once. */
  private ringmasterIdCache: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly betWallet: BetWalletService,
    private readonly outbox: OutboxService,
    private readonly flags: FeatureFlagService,
    private readonly outbidListener: OutbidListenerService,
    private readonly rg: ResponsibleGamblingService,
    private readonly fraud: FraudService,
  ) {}

  /**
   * Place a bid. Flow is unchanged for NORMAL auctions:
   *
   *   1. Validate auction (LIVE, not expired, user-not-already-winning).
   *   2. Insert the bid row first → we get a stable id for the wallet
   *      debit reference.
   *   3. Debit `coinsPerBid` from Bet's wallet, keyed on `bid:<bidId>`.
   *   4. If the debit throws AFTER we inserted the bid, delete the bid.
   *
   * For NO_WINNER mode: after a successful placement, if the new bid
   * would naturally classify as `LOWEST_UNIQUE`, drop a ringmaster
   * collision bid at the same amount. This shoves the user into the
   * `DUPLICATE_COLLIDING` bucket and guarantees no one wins. The
   * ringmaster's bid is a real DB row — when the admin flips the
   * switch back to NORMAL, those rows persist so previously-shown
   * statuses stay consistent.
   *
   * For FIXED_WINNER mode: no auto-bid. The classifier + winner-picker
   * read `auction.fixedWinningAmount` to decide outcomes.
   */
  async placeBid(userId: string, auctionId: string, amount: string) {
    const candidate = new Decimal(amount);
    if (candidate.lte(0)) {
      throw new BadRequestException('amount must be positive');
    }

    const auction = await this.prisma.auction.findUnique({
      where: { id: auctionId },
    });
    if (!auction) throw new NotFoundException('auction not found');
    if (auction.status !== 'LIVE') throw new ForbiddenException('auction not live');
    if (auction.endsAt.getTime() <= Date.now()) {
      throw new ForbiddenException('auction has ended');
    }

    // Responsible-gambling pre-bet gate. Fires BEFORE we insert a
    // bid row so a blocked bid doesn't materialise + need rollback.
    // Throws ForbiddenException on cooldown / self-exclusion / daily-
    // wager-limit reached. Audit row is written inside the service.
    await this.rg.assertCanBet(userId, auction.coinsPerBid);

    const classifyOpts: ClassifyOpts = classifyOptsFromAuction(auction);

    // Block re-bidding while the user already holds the winning bid —
    // under NORMAL rules AND under FIXED_WINNER (where "winning" means
    // earliest at the fixed amount). Under NO_WINNER nobody wins, so
    // skip this guard there.
    if (auction.manipulationMode !== 'NO_WINNER') {
      const lastUserBid = await this.prisma.bid.findFirst({
        where: { auctionId, userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (lastUserBid) {
        const allBids = await this.fetchBidRows(auctionId);
        const status = classifyBidFor(lastUserBid.id, allBids, classifyOpts);
        if (status === 'LOWEST_UNIQUE') {
          throw new ConflictException(
            'You already hold the winning bid. Wait until another player matches or undercuts it.',
          );
        }
      }
    }

    // 2. Insert the bid + enqueue the wallet debit.
    //
    // Two paths, gated by `outbox.bid_wallet_debit`:
    //
    //   ON  → Atomic. `bid.create` + `outbox.enqueue` commit in the
    //         same Prisma transaction. The outbox worker drains the
    //         debit asynchronously (at-least-once, idempotent via
    //         the `bid:<bidId>` reference). Audit finding #8 from
    //         PR #28: this is the correct fix for the cross-service
    //         consistency gap.
    //
    //   OFF → Legacy. Bid is inserted, then a blocking HTTP debit
    //         fires. If the debit throws, the bid is deleted. Lost
    //         response (5xx after Bet committed) leaves the user
    //         short the coins — that's the bug, but it's also the
    //         well-trodden path. Keep available for instant rollback
    //         if the outbox path misbehaves.
    //
    // Flag is in `FeatureFlag` table, seeded OFF by the
    // 20260520160000_outbox_seed migration. Flip ON via admin UI.
    const useOutbox = await this.flags.isEnabled('outbox.bid_wallet_debit');

    type BidPersisted = Awaited<ReturnType<typeof this.prisma.bid.create>>;
    let bid: BidPersisted;
    if (useOutbox) {
      bid = await this.prisma.$transaction(async (tx) => {
        const created = await tx.bid.create({
          data: {
            auctionId,
            userId,
            amount: candidate.toFixed(2),
          },
        });
        await this.outbox.enqueue(tx, {
          kind: OutboxKind.BET_WALLET_DEBIT,
          sourceTable: 'Bid',
          sourceId: created.id,
          payload: {
            userId,
            amount: auction.coinsPerBid,
            kind: 'auction_bid',
            reference: `bid:${created.id}`,
            metadata: {
              auctionId,
              bidId: created.id,
              amount: candidate.toFixed(2),
            },
          },
          // The receiving service (Bet) dedupes on `(kind,
          // reference)`. Mirror that pair as the outbox row's
          // idempotency key so a duplicate enqueue (very unlikely
          // — would require a Prisma client crash mid-transaction)
          // hits a uniq constraint, not a duplicate dispatch.
          idempotencyKey: `bet_wallet_debit:bid:${created.id}`,
        });
        return created;
      });
    } else {
      bid = await this.prisma.bid.create({
        data: {
          auctionId,
          userId,
          amount: candidate.toFixed(2),
        },
      });
      try {
        await this.betWallet.debit({
          userId,
          amount: auction.coinsPerBid,
          kind: 'auction_bid',
          reference: `bid:${bid.id}`,
          metadata: { auctionId, bidId: bid.id, amount: candidate.toFixed(2) },
        });
      } catch (err) {
        await this.prisma.bid
          .delete({ where: { id: bid.id } })
          .catch((deleteErr) =>
            this.logger.error(
              `failed to roll back bid ${bid.id} after wallet error: ${deleteErr.message}`,
            ),
          );
        throw err;
      }
    }

    // NO_WINNER mode: if this new bid would have been the winner, the
    // ringmaster drops a collision so it isn't. The check has to
    // happen AFTER the new bid is persisted (the classifier reads the
    // full bid set). Failures here log and continue — we shouldn't
    // refund the user just because the ringmaster fell over.
    if (auction.manipulationMode === 'NO_WINNER') {
      try {
        const allBids = await this.fetchBidRows(auctionId);
        const status = classifyBidFor(bid.id, allBids, classifyOpts);
        if (status === 'LOWEST_UNIQUE') {
          await this.placeRingmasterCollision(auctionId, candidate);
        }
      } catch (err) {
        this.logger.error(
          `NO_WINNER auto-collide on auction ${auctionId} failed: ${(err as Error).message}`,
        );
      }
    }

    // Outbid notifications — fire-and-forget. The listener owns its
    // own feature-flag gate (watchlist.outbid_notifications), its
    // own debounce, and its own error swallow, so a notification
    // failure can never fail the bid placement.
    void this.outbidListener
      .onBidPlaced({
        auctionId,
        newBidderId: userId,
        newBidId: bid.id,
        newBidAmount: candidate,
      })
      .catch((err) => {
        this.logger.error(
          `outbid listener failed for bid=${bid.id}: ${(err as Error).message}`,
        );
      });

    // Fraud velocity check — fire-and-forget, like the outbid listener.
    // Gated by the same `fraud.evaluator_enabled` flag as the nightly
    // cluster sweep (default OFF) so the security team controls when
    // signals start being written. The flag check + count run off the
    // request path; any failure is swallowed so it can never fail a bid.
    void this.flags
      .isEnabled('fraud.evaluator_enabled')
      .then((on) => (on ? this.fraud.checkBidVelocity(userId) : undefined))
      .catch((err) => {
        this.logger.error(
          `fraud velocity check failed for bid=${bid.id}: ${(err as Error).message}`,
        );
      });

    return bid;
  }

  /**
   * Return raw bid amounts for an auction. NEVER expose to clients — used
   * internally by the gateway to classify each subscriber's latest bid.
   */
  async amountsForAuction(auctionId: string): Promise<Decimal[]> {
    const rows = await this.prisma.bid.findMany({
      where: { auctionId },
      select: { amount: true },
    });
    return rows.map((b) => new Decimal(b.amount.toString()));
  }

  /**
   * Full Bid rows (id + userId + amount + createdAt) for an auction.
   * Used by the gateway when classifying subscribers under FIXED_WINNER
   * mode, which needs timestamps to resolve "earliest bidder wins".
   * Internal-only.
   */
  async fetchBidRows(auctionId: string): Promise<BidRow[]> {
    const rows = await this.prisma.bid.findMany({
      where: { auctionId },
      select: { id: true, userId: true, amount: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      amount: new Decimal(r.amount.toString()),
      createdAt: r.createdAt,
    }));
  }

  /**
   * Auction-scoped classify opts derived from the manipulation mode +
   * fixed amount. Re-fetches the auction row — keep call sites tight.
   */
  async classifyOptsForAuction(auctionId: string): Promise<ClassifyOpts> {
    const a = await this.prisma.auction.findUnique({
      where: { id: auctionId },
      select: { manipulationMode: true, fixedWinningAmount: true },
    });
    if (!a) return {};
    return classifyOptsFromAuction(a);
  }

  /**
   * Most recent bid the user has placed on this auction (or null if none).
   * Used on WS subscribe to immediately push the user's status, and after
   * any bid lands to refresh every subscriber.
   */
  async getLatestBidForUser(auctionId: string, userId: string) {
    return this.prisma.bid.findFirst({
      where: { auctionId, userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, amount: true, createdAt: true },
    });
  }

  // ─── Ringmaster (NO_WINNER mode) ──────────────────────────────────────

  /**
   * Get-or-create the ringmaster user. Idempotent; cached per process.
   * No password — nobody can log in as the ringmaster, the row only
   * exists so bid foreign-keys resolve and audit rows have a real
   * owner. `passwordHash` is set to a bcrypt-shaped string that can
   * never validate (empty hash output).
   */
  private async ensureRingmasterId(): Promise<string> {
    if (this.ringmasterIdCache) return this.ringmasterIdCache;
    const existing = await this.prisma.user.findUnique({
      where: { email: RINGMASTER_EMAIL },
      select: { id: true },
    });
    if (existing) {
      this.ringmasterIdCache = existing.id;
      return existing.id;
    }
    const created = await this.prisma.user.upsert({
      where: { email: RINGMASTER_EMAIL },
      update: {},
      create: {
        email: RINGMASTER_EMAIL,
        username: RINGMASTER_USERNAME,
        // bcrypt salt-only string — verify() always returns false.
        passwordHash: '$2b$10$invalid.never.matches.................',
        emailVerified: false,
      },
      select: { id: true },
    });
    this.ringmasterIdCache = created.id;
    return created.id;
  }

  /**
   * Place a ringmaster collision bid at `amount`. No wallet debit — the
   * ringmaster is a system user, its coin balance is irrelevant. The
   * insert is best-effort; failures bubble up to the caller's try/catch.
   */
  private async placeRingmasterCollision(auctionId: string, amount: Decimal) {
    const ringmasterId = await this.ensureRingmasterId();
    await this.prisma.bid.create({
      data: {
        auctionId,
        userId: ringmasterId,
        amount: amount.toFixed(2),
      },
    });
    this.logger.log(
      `ringmaster placed collision @${amount.toFixed(2)} on auction ${auctionId}`,
    );
  }

  /**
   * Iteratively neutralise every existing `LOWEST_UNIQUE` bid in the
   * pool by spawning a ringmaster collision at its amount. Used when an
   * admin flips a LIVE auction into NO_WINNER mode — bids placed BEFORE
   * the flip might already be winning, and the per-placement collision
   * in `placeBid` only fires on incoming bids, never retroactively.
   *
   * Each iteration removes one "winning" amount from the pool (turning
   * the previously-unique amount into a duplicate). Because that can
   * promote a previously-LOSING bid to LOWEST_UNIQUE — there's always
   * a new "next-lowest unique" while any unique amounts remain — we
   * loop. Termination is guaranteed by the bounded number of distinct
   * amounts; the iteration cap is a defensive ceiling against any
   * pathological state.
   *
   * Returns the number of phantoms placed. Safe to call when nothing
   * needs neutralising (returns 0 immediately).
   */
  async cascadeRingmasterCollisions(auctionId: string): Promise<number> {
    let placed = 0;
    const MAX_ITER = 200;
    for (let i = 0; i < MAX_ITER; i++) {
      const allBids = await this.fetchBidRows(auctionId);
      const opts = await this.classifyOptsForAuction(auctionId);
      const target = allBids.find(
        (b) => classifyBidFor(b.id, allBids, opts) === 'LOWEST_UNIQUE',
      );
      if (!target) break;
      await this.placeRingmasterCollision(auctionId, target.amount);
      placed += 1;
    }
    if (placed > 0) {
      this.logger.log(
        `ringmaster cascade placed ${placed} collisions on auction ${auctionId}`,
      );
    }
    return placed;
  }
}
