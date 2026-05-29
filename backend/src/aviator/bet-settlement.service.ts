import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { BetWalletService } from '../bet-wallet/bet-wallet.service';
import { AviatorState, ActiveBet } from './aviator-state';
import { AviatorGateway } from './aviator.gateway';
import {
  applyPayoutCap,
  isCapActive,
  type PayoutCapConfig,
  type PayoutCapResult,
} from './payout-cap';

/**
 * Bet placement + cashout settlement (PR-ARCH-AUDIT, Stage B —
 * extracted from the AviatorService god-class).
 *
 * Responsibilities:
 *   - placeBet:   validate phase, atomically insert AviatorBet row,
 *                 debit Bet wallet, rollback on debit failure.
 *   - cashout:    manual cashout entry — delegates to cashoutInternal
 *                 at the current multiplier.
 *   - cashoutInternal: SINGLE chokepoint for ALL cashouts (manual,
 *                 auto-on-target, cap-triggered). Called from this
 *                 service AND from RoundLifecycleService.tick().
 *
 * Money math: settlement amounts flow through `applyPayoutCap`
 * (payout-cap.ts), which has a deliberate, documented decision to
 * stay in JS Number arithmetic for byte-identical rounding vs the
 * legacy path. The audit identified this as a P0 risk but examining
 * the helper showed the choice was intentional and tested. We do
 * NOT change that here. The display-only multiplication in
 * crashRound's EMA observation (RoundLifecycleService) uses Decimal
 * since it's not the wallet path.
 */
@Injectable()
export class BetSettlementService {
  private readonly logger = new Logger(BetSettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly betWallet: BetWalletService,
    private readonly state: AviatorState,
    private readonly gateway: AviatorGateway,
  ) {}

  async placeBet(
    userId: string,
    username: string,
    amount: number,
    autoCashoutAt: number | null,
  ) {
    if (this.state.phase !== 'BETTING' || !this.state.current) {
      throw new ForbiddenException('betting closed');
    }
    if (this.state.bets.has(userId)) {
      throw new ConflictException('already bet on this round');
    }
    if (amount < 1) throw new BadRequestException('amount must be ≥ 1');

    // Insert the bet first so we have a stable id for the wallet
    // ref, then debit Bet's wallet. If the debit fails (insufficient
    // coins, banned user, etc.), roll the bet row back so it doesn't
    // appear in the round's roster as an unpaid stake. Same saga
    // pattern as BidsService.placeBid in the auctions flow.
    const created = await this.prisma.aviatorBet.create({
      data: {
        userId,
        roundId: this.state.current.roundId,
        amount,
        autoCashoutAt: autoCashoutAt?.toFixed(2),
      },
    });
    try {
      await this.betWallet.debit({
        userId,
        amount,
        kind: 'aviator_stake',
        reference: `aviator-stake:${created.id}`,
        metadata: {
          roundId: this.state.current.roundId,
          aviatorBetId: created.id,
          autoCashoutAt,
        },
      });
    } catch (err) {
      await this.prisma.aviatorBet
        .delete({ where: { id: created.id } })
        .catch((deleteErr) =>
          this.logger.error(
            `failed to roll back aviator bet ${created.id}: ${
              deleteErr instanceof Error ? deleteErr.message : deleteErr
            }`,
          ),
        );
      throw err;
    }
    // No local audit row — Bet's Transaction table is the single
    // source of truth for coin movement now. AviatorBet itself
    // carries the game-specific state.
    this.state.bets.set(userId, {
      betId: created.id,
      userId,
      username,
      amount,
      autoCashoutAt,
      cashedOutAt: null,
    });
    this.gateway.emit('PLAYER_BET', { username, amount, autoCashoutAt });

    return { betId: created.id, amount, autoCashoutAt };
  }

  async cashout(userId: string) {
    const bet = this.state.bets.get(userId);
    if (!bet) throw new NotFoundException('no active bet');
    if (this.state.phase !== 'RUNNING') {
      throw new ForbiddenException('round not running');
    }
    if (bet.cashedOutAt !== null) {
      throw new ConflictException('already cashed out');
    }

    return this.cashoutInternal(bet, this.state.currentMultiplier, {
      reason: 'manual',
    });
  }

  /**
   * Internal settle path — single chokepoint for ALL cashouts
   * (manual, auto-on-target, and cap-triggered).
   *
   * `opts.reason` is informational only (logged + threaded to the
   * websocket flag) but reserved for future analytics — e.g.
   * distinguishing manual vs auto cashouts in the recon job.
   *
   * Idempotency: the `bet.cashedOutAt !== null` early-return on the
   * first line makes this safe to call from the tick loop AND the
   * HTTP path simultaneously. NestJS is single-threaded so the
   * `bet.cashedOutAt = multiplier` assignment is the critical
   * section; once set, every subsequent invocation no-ops.
   */
  async cashoutInternal(
    bet: ActiveBet,
    multiplier: number,
    opts?: { reason?: 'manual' | 'auto' | 'cap' },
  ) {
    if (bet.cashedOutAt !== null) return null;
    bet.cashedOutAt = multiplier;

    const capConfig: PayoutCapConfig = this.state.current?.payoutCap ?? {
      enabled: false,
      maxCoins: 0,
    };
    const capResult: PayoutCapResult = applyPayoutCap(
      bet.amount,
      multiplier,
      capConfig,
    );
    const payout = capResult.payout;

    // The tick-loop's cap-triggered path settles a bet at EXACTLY
    // `capMultiplier(stake, cap)` — at that point the raw payout
    // equals the cap to the coin, so `applyPayoutCap.capped` is
    // technically false. But the cap is what caused the settlement;
    // UX-wise the player MUST see "MAX PAYOUT REACHED", and the
    // audit row MUST flag this for compliance. Treat `reason: 'cap'`
    // as conclusively capped regardless of the raw arithmetic.
    const capped =
      capResult.capped ||
      (opts?.reason === 'cap' && isCapActive(capConfig));

    // Credit through Bet first — that's the source of truth. If the
    // credit fails (network glitch), we still mark the bet
    // `cashedOutAt` locally because the user's choice has happened;
    // the Bet credit can be retried by an admin reading
    // WalletTransaction rows that have no matching Bet ledger entry.
    let betWalletOk = false;
    try {
      await this.betWallet.credit({
        userId: bet.userId,
        amount: payout,
        kind: 'aviator_cashout',
        reference: `aviator-cashout:${bet.betId}`,
        metadata: {
          aviatorBetId: bet.betId,
          multiplier: Number(multiplier.toFixed(2)),
          roundNumber: this.state.current?.roundNumber,
          payoutCapped: capped || undefined,
          originalPayoutCoins: capped ? capResult.originalPayout : undefined,
          payoutCapCoins: capResult.appliedCapCoins ?? undefined,
        },
      });
      betWalletOk = true;
    } catch (err) {
      this.logger.error(
        `Aviator cashout: Bet credit failed for user ${bet.userId} bet ${bet.betId} payout ${payout}: ${
          err instanceof Error ? err.message : err
        } — bet still marked cashed-out, admin must reconcile.`,
      );
    }

    await this.prisma.aviatorBet.update({
      where: { id: bet.betId },
      data: {
        cashedOutAt: new Date(),
        cashedOutMultiplier: multiplier.toFixed(2),
        payout: betWalletOk ? payout : 0,
        originalPayoutCoins: capResult.originalPayout,
        payoutCapCoins: capResult.appliedCapCoins,
        cappedByPayoutCap: capped,
      },
    });

    if (capped) {
      this.logger.log(
        `aviator-cashout reason=${opts?.reason ?? 'manual'} ` +
          `bet=${bet.betId} user=${bet.userId} ` +
          `stake=${bet.amount} multiplier=${multiplier.toFixed(2)} ` +
          `originalPayout=${capResult.originalPayout} ` +
          `cappedPayout=${payout} cap=${capResult.appliedCapCoins}`,
      );
    }

    // If the Bet credit failed, the coins never landed — `payout: 0`
    // was just persisted to AviatorBet. Do NOT advertise the win
    // amount: keep it out of the persistent recent-winners feed and
    // broadcast it as a pending settlement (payout 0 +
    // `settlementPending`) so the player still sees their cashout
    // recorded (roster mark / local bet state) while an admin
    // reconciles the missing credit. The previous code broadcast the
    // REAL payout here, showing a phantom win to every client even
    // though nothing was credited.
    const effectivePayout = betWalletOk ? payout : 0;
    const winner = {
      username: bet.username,
      multiplier: Number(multiplier.toFixed(2)),
      payout: effectivePayout,
      roundNumber: this.state.current?.roundNumber ?? 0,
      at: Date.now(),
    };
    if (betWalletOk) {
      this.state.pushRecentWinner(winner);
    }

    this.gateway.emit('PLAYER_CASHOUT', {
      ...winner,
      ...(betWalletOk ? {} : { settlementPending: true }),
      ...(capped
        ? {
            capped: true,
            originalPayout: capResult.originalPayout,
            payoutCapCoins: capResult.appliedCapCoins,
          }
        : {}),
    });

    return { multiplier, payout, capped };
  }
}

/**
 * Display-only payout helper for reporting paths (admin current-round
 * tiles, EMA observation in crashRound). Money paths use
 * `applyPayoutCap` exclusively.
 *
 * Uses Decimal to make the reporting numbers exact, since these can
 * be summed over many bets. The wallet path stayed on JS Number
 * arithmetic by design (see payout-cap.ts).
 */
export function reportingPayout(stake: number, multiplier: number): number {
  if (!Number.isFinite(stake) || stake <= 0) return 0;
  if (!Number.isFinite(multiplier) || multiplier < 1) return 0;
  return new Decimal(stake).times(multiplier).floor().toNumber();
}
