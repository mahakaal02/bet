import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import Decimal from 'decimal.js';
import { Server as SocketIoServer, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../auth/auth.service';
import { BetWalletService } from '../bet-wallet/bet-wallet.service';
import { computeCrashMultiplier, multiplierAt } from './fairness';
import { FairnessStore } from './fairness-store';
import { AviatorChatService } from './chat.service';
import {
  CrashDistributionService,
  GenerateResult,
} from './crash/crash-distribution.service';
import { SettingsService } from '../foundation/settings.service';
import {
  applyPayoutCap,
  capMultiplier,
  isCapActive,
  loadCapConfig,
  type PayoutCapConfig,
  type PayoutCapResult,
} from './payout-cap';

type Phase = 'BETTING' | 'RUNNING' | 'CRASHED';

const BETTING_MS = 10_000;
const CRASH_HOLD_MS = 3_000;
const TICK_MS = 100;
const RECENT_WINNERS_LIMIT = 20;

interface ActiveBet {
  betId: string;
  userId: string;
  username: string;
  amount: number;
  autoCashoutAt: number | null;
  cashedOutAt: number | null;
}

interface CurrentRoundState {
  roundId: string;
  roundNumber: number;
  seedId: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  crashMultiplier: number;
  startedAt: number;
  /**
   * Result of the heavy-tail engine when it produced this round; `null`
   * when the round was decided by the legacy `computeCrashMultiplier`
   * (engine disabled, or forced override / max-payout clip in play).
   * Used by `crashRound` to feed the round's realised outcome back
   * into the `ExposureTracker` EMA.
   */
  engine: GenerateResult | null;
  /**
   * PR-AVIATOR-PAYOUT-CAP — snapshot of the cap config taken at
   * `startBettingPhase`. Held constant for the whole round so an
   * admin edit (which only takes effect once SettingsService's 60s
   * TTL expires anyway) cannot move the cap line under a player who
   * already placed a bet. Next round picks up the new value.
   */
  payoutCap: PayoutCapConfig;
}

interface RecentWinner {
  username: string;
  multiplier: number;
  payout: number;
  roundNumber: number;
  at: number;
}

@Injectable()
export class AviatorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AviatorService.name);

  private io!: SocketIoServer;
  private phase: Phase = 'BETTING';
  private current: CurrentRoundState | null = null;
  private bets = new Map<string, ActiveBet>();
  private tickTimer: NodeJS.Timeout | null = null;
  private phaseTimer: NodeJS.Timeout | null = null;
  private bettingClosesAt: number = 0;
  private currentMultiplier: number = 1.0;
  private lastRoundNumber: number = 0;
  private roundsUsedInCurrentSeed: number = 0;

  private recentWinners: RecentWinner[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly jwt: JwtService,
    private readonly fairness: FairnessStore,
    private readonly chat: AviatorChatService,
    private readonly betWallet: BetWalletService,
    private readonly crashEngine: CrashDistributionService,
    // PR-AVIATOR-PAYOUT-CAP — used to load the per-round cap
    // snapshot in `startBettingPhase`. Same SettingsService that
    // backs the crash-engine config; no new infra.
    private readonly settings: SettingsService,
  ) {}

  async onApplicationBootstrap() {
    this.attachSocketIo();
    await this.bootstrapState();
    void this.startBettingPhase();
  }

  onModuleDestroy() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.io?.close();
  }

  // ── socket.io setup ───────────────────────────────────────────────────────

  private attachSocketIo() {
    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer();
    this.io = new SocketIoServer(httpServer, {
      cors: { origin: '*' },
      path: '/aviator/socket.io',
    });

    this.io.use(async (socket, next) => {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (socket.handshake.query?.token as string | undefined);
      if (!token) return next(new Error('unauthorized'));
      try {
        const payload = this.jwt.verify<JwtPayload>(token);
        socket.data.userId = payload.sub;
        socket.data.username = payload.username;
        return next();
      } catch {
        return next(new Error('unauthorized'));
      }
    });

    this.io.on('connection', (socket: Socket) => {
      // Snapshot of state + history so a freshly-connected client renders
      // a complete UI without any extra REST calls.
      socket.emit('STATE_SNAPSHOT', this.snapshotPublicState());
      socket.emit('PLAYER_ROSTER', this.publicRoster());
      socket.emit('RECENT_WINNERS', this.recentWinners);
      void this.chat
        .recent(50)
        .then((messages) => socket.emit('CHAT_HISTORY', messages))
        .catch(() => {});

      socket.on('CHAT_SEND', async (payload: { message?: string }, ack?: (r: unknown) => void) => {
        const message = (payload?.message ?? '').toString();
        try {
          const userId = socket.data.userId as string;
          const username = socket.data.username as string;
          const sent = await this.chat.send(userId, username, message);
          this.io.emit('CHAT_MESSAGE', sent);
          ack?.({ ok: true, id: sent.id });
        } catch (e: any) {
          ack?.({ ok: false, error: e?.message ?? 'send failed' });
        }
      });

      this.broadcastPlayerCount();
      socket.on('disconnect', () => this.broadcastPlayerCount());
    });

    this.logger.log('Aviator socket.io attached at /aviator/socket.io');
  }

  private broadcastPlayerCount() {
    this.io?.emit('ONLINE_COUNT', { count: this.io.engine.clientsCount });
  }

  // ── state bootstrap ───────────────────────────────────────────────────────

  private async bootstrapState() {
    const orphaned = await this.prisma.aviatorRound.updateMany({
      where: { status: { in: ['BETTING', 'RUNNING'] } },
      data: { status: 'CRASHED', crashedAt: new Date() },
    });
    if (orphaned.count > 0) {
      this.logger.warn(`marked ${orphaned.count} orphaned round(s) CRASHED on bootstrap`);
    }

    const last = await this.prisma.aviatorRound.findFirst({
      orderBy: { roundNumber: 'desc' },
      select: { roundNumber: true, seedId: true },
    });
    this.lastRoundNumber = last?.roundNumber ?? 0;

    if (last?.seedId) {
      this.roundsUsedInCurrentSeed = await this.prisma.aviatorRound.count({
        where: { seedId: last.seedId },
      });
    }
  }

  // ── phase transitions ─────────────────────────────────────────────────────

  private async startBettingPhase() {
    this.phase = 'BETTING';
    this.bets.clear();
    this.currentMultiplier = 1.0;

    // Auto-rotate the seed if it's been running for too many rounds.
    if (this.fairness.shouldAutoRotate(this.roundsUsedInCurrentSeed)) {
      await this.rotateSeed('max_rounds');
    }

    const seed = await this.fairness.getOrCreateActive(this.lastRoundNumber);

    let roundNumber = this.lastRoundNumber + 1;
    const nonce = this.roundsUsedInCurrentSeed + 1;

    // Heavy-tail engine has first refusal. When enabled via
    // `aviator.crash.engine=heavytail`, it reads the same seed batch
    // (different HMAC domain → no cryptographic overlap) and produces
    // a multiplier whose distribution matches the configured RTP /
    // bucket targets. When disabled, returns null and we fall back to
    // the legacy `computeCrashMultiplier`. Refreshing config every
    // round picks up admin edits without bouncing the pod.
    await this.crashEngine.refreshConfig();
    const engineResult = this.crashEngine.generate({
      serverSeed: seed.serverSeed,
      clientSeed: seed.clientSeed,
      nonce,
    });
    const naturalCrash =
      engineResult?.multiplier ??
      computeCrashMultiplier(seed.serverSeed, seed.clientSeed, nonce);

    // Admin knobs (see model `AviatorSettings`):
    //   1. `forcedNextPayout` — one-shot override. Consume in a single
    //      UPDATE … RETURNING so the next round can't accidentally
    //      reuse the same forced value if two phase starts race. If
    //      the consume reads a value, the round flies to exactly that.
    //   2. `maxPayout` — global ceiling. Applied AFTER the natural
    //      crash so the provably-fair RNG output is unchanged; we just
    //      cap the visible result. Forced overrides are clipped too —
    //      admins can't accidentally smuggle a 1000x payout past their
    //      own ceiling.
    const forced = await this.consumeForcedNextPayout();
    const ceiling = await this.readMaxPayout();
    let crashMultiplier = forced !== null ? forced : naturalCrash;
    if (ceiling !== null && crashMultiplier > ceiling) {
      crashMultiplier = ceiling;
    }
    // Never publish < 1.00 — the engine's lower bound is 1.00 (insta-crash).
    if (crashMultiplier < 1) crashMultiplier = 1;

    // Structured audit log: one line per round capturing every input
    // an auditor needs to reproduce the crash multiplier from cold.
    // No PII; safe to ship to a centralised log store.
    if (engineResult) {
      this.logger.log(
        `crash-engine round=${roundNumber} nonce=${nonce} ` +
          `seedHash=${seed.serverSeedHash.slice(0, 12)} ` +
          `mode=${engineResult.mode} ` +
          `exposureFactor=${engineResult.exposureFactor.toFixed(4)} ` +
          `rtp=${engineResult.targetRtp.toFixed(4)} ` +
          `paramsHash=${engineResult.paramsHash} ` +
          `naturalCrash=${engineResult.multiplier.toFixed(2)} ` +
          `published=${crashMultiplier.toFixed(2)}` +
          (forced !== null ? ` forced=${forced}` : '') +
          (ceiling !== null ? ` ceiling=${ceiling}` : ''),
      );
    }

    let row;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        row = await this.prisma.aviatorRound.create({
          data: {
            roundNumber,
            seedId: seed.id,
            nonce,
            serverSeed: seed.serverSeed,
            serverSeedHash: seed.serverSeedHash,
            clientSeed: seed.clientSeed,
            crashMultiplier: crashMultiplier.toFixed(2),
            status: 'BETTING',
          },
        });
        break;
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e;
        roundNumber++;
      }
    }
    if (!row) throw new Error('could not allocate round number after retries');

    this.lastRoundNumber = roundNumber;
    this.roundsUsedInCurrentSeed++;
    await this.fairness.markStartRound(seed.id, roundNumber);

    // PR-AVIATOR-PAYOUT-CAP — read the cap config exactly once per
    // round, BEFORE any bets are accepted. Snapshotting here gives
    // every bet in this round the same cap (auditable, predictable);
    // an admin lowering the cap mid-round can't yank rugs out from
    // under live bets. New value takes effect on the next round.
    const payoutCap = await loadCapConfig(this.settings);

    this.current = {
      roundId: row.id,
      roundNumber,
      seedId: seed.id,
      serverSeed: seed.serverSeed,
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonce,
      crashMultiplier,
      startedAt: 0,
      engine: engineResult,
      payoutCap,
    };
    this.bettingClosesAt = Date.now() + BETTING_MS;

    this.io.emit('GAME_START', {
      roundId: row.id,
      roundNumber,
      seedId: seed.id,
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonce,
      bettingEndsAt: this.bettingClosesAt,
    });

    this.phaseTimer = setTimeout(() => this.startRunningPhase(), BETTING_MS);
  }

  private async startRunningPhase() {
    if (!this.current) return;
    this.phase = 'RUNNING';
    this.current.startedAt = Date.now();
    await this.prisma.aviatorRound.update({
      where: { id: this.current.roundId },
      data: { status: 'RUNNING', startedAt: new Date(this.current.startedAt) },
    });
    this.io.emit('GAME_RUNNING', {
      roundId: this.current.roundId,
      startedAt: this.current.startedAt,
    });

    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
  }

  private async tick() {
    if (!this.current || this.phase !== 'RUNNING') return;
    const elapsed = Date.now() - this.current.startedAt;
    this.currentMultiplier = multiplierAt(elapsed);

    for (const bet of this.bets.values()) {
      if (
        bet.cashedOutAt === null &&
        bet.autoCashoutAt !== null &&
        this.currentMultiplier >= bet.autoCashoutAt
      ) {
        await this.cashoutInternal(bet, bet.autoCashoutAt);
      }
    }

    if (this.currentMultiplier >= this.current.crashMultiplier) {
      await this.crashRound();
      return;
    }

    this.io.emit('MULTIPLIER_UPDATE', {
      multiplier: Number(this.currentMultiplier.toFixed(2)),
      elapsed,
    });
  }

  private async crashRound() {
    if (!this.current) return;
    this.phase = 'CRASHED';
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    const crashedAt = new Date();
    await this.prisma.aviatorRound.update({
      where: { id: this.current.roundId },
      data: { status: 'CRASHED', crashedAt },
    });

    // Feed realised outcome back into the crash-engine's EMA tracker
    // BEFORE clearing `this.bets`. Total payout sums each cashed-out
    // bet at its locked-in multiplier; bets that didn't cash out
    // contribute 0 (their stake is house revenue). This is the same
    // formula `cashoutInternal` uses when crediting the wallet, so
    // the rolling RTP the tracker reports matches the realised
    // house P&L.
    let totalStake = 0;
    let totalPayout = 0;
    for (const bet of this.bets.values()) {
      totalStake += bet.amount;
      if (bet.cashedOutAt !== null) {
        totalPayout += Math.floor(bet.amount * bet.cashedOutAt);
      }
    }
    this.crashEngine.observeRoundOutcome({
      stake: totalStake,
      payout: totalPayout,
      bettors: this.bets.size,
    });

    this.io.emit('GAME_CRASH', {
      roundId: this.current.roundId,
      roundNumber: this.current.roundNumber,
      crashMultiplier: this.current.crashMultiplier,
      // Per-round seed reveal is preserved so existing clients keep working,
      // but proper verification now uses the seed-batch reveal at rotation.
      serverSeed: this.current.serverSeed,
      clientSeed: this.current.clientSeed,
      nonce: this.current.nonce,
    });

    this.phaseTimer = setTimeout(() => this.startBettingPhase(), CRASH_HOLD_MS);
  }

  // ── seed rotation ─────────────────────────────────────────────────────────

  async rotateSeed(reason: 'scheduled' | 'admin' | 'max_rounds') {
    const result = await this.fairness.rotate(reason, this.lastRoundNumber);
    this.roundsUsedInCurrentSeed = 0;
    this.io?.emit('SEED_ROTATED', {
      revealed: {
        id: result.revealed.id,
        serverSeed: result.revealed.serverSeed,
        serverSeedHash: result.revealed.serverSeedHash,
        clientSeed: result.revealed.clientSeed,
        revealedAt: result.revealed.revealedAt.toISOString(),
        startRoundNumber: result.revealed.startRoundNumber,
        endRoundNumber: result.revealed.endRoundNumber,
        rotationReason: reason,
      },
      next: {
        id: result.next.id,
        serverSeedHash: result.next.serverSeedHash,
        clientSeed: result.next.clientSeed,
      },
    });
    return result;
  }

  // ── public API used by the REST controller ───────────────────────────────

  async getBalance(userId: string): Promise<number> {
    // Coins live on Bet — single source of truth. We surface the error
    // rather than hiding it behind a column read that no longer exists:
    // a "₹0 because Bet was down" reading is worse than an explicit
    // error the client can retry on.
    return this.betWallet.balance(userId);
  }

  async placeBet(
    userId: string,
    username: string,
    amount: number,
    autoCashoutAt: number | null,
  ) {
    if (this.phase !== 'BETTING' || !this.current) {
      throw new ForbiddenException('betting closed');
    }
    if (this.bets.has(userId)) {
      throw new ConflictException('already bet on this round');
    }
    if (amount < 1) throw new BadRequestException('amount must be ≥ 1');

    // Insert the bet first so we have a stable id for the wallet ref,
    // then debit Bet's wallet. If the debit fails (insufficient coins,
    // banned user, etc.), roll the bet row back so it doesn't appear in
    // the round's roster as an unpaid stake. Same saga pattern as
    // BidsService.placeBid in the auctions flow.
    const created = await this.prisma.aviatorBet.create({
      data: {
        userId,
        roundId: this.current.roundId,
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
          roundId: this.current.roundId,
          aviatorBetId: created.id,
          autoCashoutAt,
        },
      });
    } catch (err) {
      await this.prisma.aviatorBet
        .delete({ where: { id: created.id } })
        .catch((deleteErr) =>
          this.logger.error(
            `failed to roll back aviator bet ${created.id}: ${deleteErr.message}`,
          ),
        );
      throw err;
    }
    // No local audit row — Bet's Transaction table is the single source
    // of truth for coin movement now. AviatorBet itself carries the
    // game-specific state (amount, autoCashoutAt, cashedOutMultiplier).
    const bet = created;

    this.bets.set(userId, {
      betId: bet.id,
      userId,
      username,
      amount,
      autoCashoutAt,
      cashedOutAt: null,
    });
    this.io.emit('PLAYER_BET', { username, amount, autoCashoutAt });

    return { betId: bet.id, amount, autoCashoutAt };
  }

  async cashout(userId: string) {
    const bet = this.bets.get(userId);
    if (!bet) throw new NotFoundException('no active bet');
    if (this.phase !== 'RUNNING') throw new ForbiddenException('round not running');
    if (bet.cashedOutAt !== null) throw new ConflictException('already cashed out');

    const multiplier = this.currentMultiplier;
    return this.cashoutInternal(bet, multiplier);
  }

  /**
   * Internal settle path — single chokepoint for ALL cashouts (manual,
   * auto-on-target, and PR-AVIATOR-PAYOUT-CAP's cap-triggered auto).
   *
   * `opts.reason` is currently informational only (logged + threaded
   * through to the websocket flag) but reserved for future analytics —
   * e.g. distinguishing manual vs auto cashouts in the recon job.
   *
   * Idempotency: the `bet.cashedOutAt !== null` early-return on the
   * first line makes this safe to call from the tick loop AND the
   * HTTP path simultaneously. NestJS is single-threaded so the
   * `bet.cashedOutAt = multiplier` assignment is the critical
   * section; once set, every subsequent invocation no-ops.
   */
  private async cashoutInternal(
    bet: ActiveBet,
    multiplier: number,
    opts?: { reason?: 'manual' | 'auto' | 'cap' },
  ) {
    if (bet.cashedOutAt !== null) return null;
    bet.cashedOutAt = multiplier;

    // PR-AVIATOR-PAYOUT-CAP — apply the per-bet cap. `applyPayoutCap`
    // floors the raw payout with the same Math.floor convention the
    // previous Decimal-based path used, so the un-capped result is
    // byte-identical to legacy behaviour.
    const capConfig: PayoutCapConfig = this.current?.payoutCap ?? {
      enabled: false,
      maxCoins: 0,
    };
    const capResult: PayoutCapResult = applyPayoutCap(
      bet.amount,
      multiplier,
      capConfig,
    );
    const payout = capResult.payout;

    // Credit through Bet first — that's the source of truth. If the
    // credit fails (network glitch), we still mark the bet `cashedOutAt`
    // locally because the user's choice has happened; the Bet credit
    // can be retried by an admin reading `WalletTransaction` rows that
    // have no matching Bet ledger entry. We catch + log rather than
    // throw because the user has already pressed the cashout button —
    // returning an error would imply nothing happened, but the round is
    // RUNNING and they can't re-cashout.
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
          roundNumber: this.current?.roundNumber,
          // Surface the cap details in the wallet ledger so a
          // dispute can be answered without joining against
          // AviatorBet — Bet's WalletTransaction.metadata is the
          // first place support staff look.
          payoutCapped: capResult.capped || undefined,
          originalPayoutCoins: capResult.capped
            ? capResult.originalPayout
            : undefined,
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

    // Persist the cashout markers + local audit row regardless. The
    // local audit row's `metadata` records whether Bet's credit
    // succeeded so the reconciliation log on AviatorBet can find any
    // stragglers (cashed-out client-side but never credited on Bet).
    //
    // PR-AVIATOR-PAYOUT-CAP — three new columns capture the cap
    // audit trail. `payout` stores the actually-credited amount
    // (capped); `originalPayoutCoins` stores the uncapped amount
    // (only meaningful when the cap fired); `payoutCapCoins` stores
    // the cap that was in force; `cappedByPayoutCap` is the
    // boolean flag for fast filtering.
    await this.prisma.aviatorBet.update({
      where: { id: bet.betId },
      data: {
        cashedOutAt: new Date(),
        cashedOutMultiplier: multiplier.toFixed(2),
        payout: betWalletOk ? payout : 0,
        originalPayoutCoins: capResult.originalPayout,
        payoutCapCoins: capResult.appliedCapCoins,
        cappedByPayoutCap: capResult.capped,
      },
    });

    // Structured log for compliance / dispute review. One line per
    // settlement, machine-parseable.
    if (capResult.capped) {
      this.logger.log(
        `aviator-cashout reason=${opts?.reason ?? 'manual'} ` +
          `bet=${bet.betId} user=${bet.userId} ` +
          `stake=${bet.amount} multiplier=${multiplier.toFixed(2)} ` +
          `originalPayout=${capResult.originalPayout} ` +
          `cappedPayout=${payout} cap=${capResult.appliedCapCoins}`,
      );
    }

    const winner: RecentWinner = {
      username: bet.username,
      multiplier: Number(multiplier.toFixed(2)),
      payout,
      roundNumber: this.current?.roundNumber ?? 0,
      at: Date.now(),
    };
    this.recentWinners.unshift(winner);
    if (this.recentWinners.length > RECENT_WINNERS_LIMIT) {
      this.recentWinners.length = RECENT_WINNERS_LIMIT;
    }

    // PR-AVIATOR-PAYOUT-CAP — emit the cap flags as OPTIONAL fields
    // on PLAYER_CASHOUT so old clients (pre-cap) keep working and
    // new clients can render "MAX PAYOUT REACHED". The bare
    // `RecentWinner` shape is unchanged; the extra props ride along
    // and are stripped by clients that don't know about them.
    this.io.emit('PLAYER_CASHOUT', {
      ...winner,
      ...(capResult.capped
        ? {
            capped: true,
            originalPayout: capResult.originalPayout,
            payoutCapCoins: capResult.appliedCapCoins,
          }
        : {}),
    });

    return { multiplier, payout, capped: capResult.capped };
  }

  // ── public history & fairness ────────────────────────────────────────────

  async recentRounds(limit = 20) {
    const rows = await this.prisma.aviatorRound.findMany({
      where: { status: 'CRASHED' },
      orderBy: { roundNumber: 'desc' },
      take: limit,
      select: {
        id: true,
        roundNumber: true,
        crashMultiplier: true,
        serverSeed: true,
        serverSeedHash: true,
        clientSeed: true,
        nonce: true,
        seedId: true,
        crashedAt: true,
      },
    });
    return rows.map((r) => ({
      ...r,
      crashMultiplier: r.crashMultiplier.toString(),
    }));
  }

  /**
   * Paginated round log for the admin dashboard. Each row carries enough to
   * reconstruct an audit timeline: round number, started/crashed timestamps,
   * crash multiplier, seed batch.
   */
  async adminRoundLog(limit = 100, beforeRoundNumber?: number) {
    const where: { status: 'CRASHED'; roundNumber?: { lt: number } } = { status: 'CRASHED' };
    if (beforeRoundNumber != null) where.roundNumber = { lt: beforeRoundNumber };
    const rows = await this.prisma.aviatorRound.findMany({
      where,
      orderBy: { roundNumber: 'desc' },
      take: Math.min(500, Math.max(1, limit)),
      select: {
        id: true,
        roundNumber: true,
        crashMultiplier: true,
        startedAt: true,
        crashedAt: true,
        seedId: true,
        nonce: true,
      },
    });
    return rows.map((r) => ({
      ...r,
      crashMultiplier: r.crashMultiplier.toString(),
    }));
  }

  // ── admin analytics ──────────────────────────────────────────────────────

  /**
   * Aggregate stats over the last [hours] hours. Used by the admin dashboard;
   * intentionally read-only and DB-only (no game-loop state) so it can run
   * even when the loop is paused.
   */
  async adminAnalytics(hours = 24) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const [rounds, betAgg, cashoutCount] = await Promise.all([
      this.prisma.aviatorRound.findMany({
        where: { status: 'CRASHED', crashedAt: { gte: since } },
        select: { id: true, roundNumber: true, crashMultiplier: true, crashedAt: true },
      }),
      this.prisma.aviatorBet.aggregate({
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        _sum: { amount: true, payout: true },
      }),
      this.prisma.aviatorBet.count({
        where: { createdAt: { gte: since }, cashedOutAt: { not: null } },
      }),
    ]);

    const totalRounds = rounds.length;
    const avgCrash = totalRounds
      ? rounds.reduce((acc, r) => acc + Number(r.crashMultiplier), 0) / totalRounds
      : 0;
    const histogram = bucketHistogram(rounds.map((r) => Number(r.crashMultiplier)));
    const totalStaked = betAgg._sum.amount ?? 0;
    const totalPaidOut = betAgg._sum.payout ?? 0;
    const totalBets = betAgg._count._all;

    return {
      sinceHours: hours,
      totalRounds,
      avgCrash: Number(avgCrash.toFixed(2)),
      totalBets,
      totalStaked,
      totalPaidOut,
      houseEdgeInr: totalStaked - totalPaidOut,
      cashoutCount,
      cashoutRate: totalBets ? Number(((cashoutCount / totalBets) * 100).toFixed(1)) : 0,
      histogram,
      onlineCount: this.io?.engine?.clientsCount ?? 0,
      currentPhase: this.phase,
      currentRoundNumber: this.current?.roundNumber ?? null,
    };
  }

  // ── live current-round snapshot ──────────────────────────────────────────

  /**
   * Snapshot of the round that's running right now. Two distinct
   * "active user" counts:
   *
   *   - onlineCount  : Socket.IO client connections (passive viewers
   *                    included; useful for capacity planning).
   *   - bettorsThisRound: distinct users who placed a bet on the
   *                    current round. This is the metric the admin
   *                    cares about for "who's actually playing".
   *
   * Stake / payout figures sum bets persisted to the DB. The in-memory
   * `bets` map is the source of truth WHILE the round is BETTING /
   * RUNNING — it's flushed on crash. We read the in-memory map first
   * for live freshness, then fall through to the DB once the round
   * has crashed.
   */
  async adminCurrentRound() {
    const phase = this.phase;
    const current = this.current;
    const onlineCount = this.io?.engine?.clientsCount ?? 0;

    if (!current) {
      return {
        phase,
        roundId: null,
        roundNumber: null,
        startedAt: null,
        crashMultiplier: null,
        onlineCount,
        bettorsThisRound: 0,
        totalStaked: 0,
        totalPaidOut: 0,
      };
    }

    let totalStaked = 0;
    let totalPaidOut = 0;
    let bettorsThisRound = 0;

    if (phase === 'BETTING' || phase === 'RUNNING') {
      // Live: read the in-memory bets map. `cashedOutAt` flips for each
      // user as soon as the matcher confirms a cashout, so payout sums
      // in real time as players exit.
      for (const b of this.bets.values()) {
        totalStaked += b.amount;
        if (b.cashedOutAt !== null) {
          // The in-memory record stores the multiplier at which they
          // exited; mirror the persistence formula used by `crashRound`.
          totalPaidOut += Math.floor(b.amount * b.cashedOutAt);
        }
      }
      bettorsThisRound = this.bets.size;
    } else {
      // CRASHED phase (rare to hit through this endpoint, but we
      // shouldn't return zeros). Fall through to the persisted row.
      const agg = await this.prisma.aviatorBet.aggregate({
        where: { roundId: current.roundId },
        _count: { _all: true },
        _sum: { amount: true, payout: true },
      });
      totalStaked = agg._sum.amount ?? 0;
      totalPaidOut = agg._sum.payout ?? 0;
      bettorsThisRound = agg._count._all;
    }

    return {
      phase,
      roundId: current.roundId,
      roundNumber: current.roundNumber,
      startedAt: current.startedAt > 0 ? new Date(current.startedAt).toISOString() : null,
      crashMultiplier: current.crashMultiplier,
      onlineCount,
      bettorsThisRound,
      totalStaked,
      totalPaidOut,
    };
  }

  /**
   * Per-user bets on the current round, for the drill-down click on
   * the "Stake on this round" tile. Returns the same shape the public
   * roster does, plus a userId for the admin to deep-link audits.
   *
   * During BETTING / RUNNING we serve from the in-memory map for
   * freshness; afterwards we serve from the persisted rows.
   */
  async adminCurrentRoundBets() {
    const current = this.current;
    if (!current) return [];

    if (this.phase === 'BETTING' || this.phase === 'RUNNING') {
      return Array.from(this.bets.values()).map((b) => ({
        betId: b.betId,
        userId: b.userId,
        username: b.username,
        amount: b.amount,
        autoCashoutAt: b.autoCashoutAt,
        cashedOutAt: b.cashedOutAt,
        payout:
          b.cashedOutAt !== null ? Math.floor(b.amount * b.cashedOutAt) : null,
      }));
    }

    const rows = await this.prisma.aviatorBet.findMany({
      where: { roundId: current.roundId },
      include: { user: { select: { username: true } } },
      orderBy: { amount: 'desc' },
    });
    return rows.map((b) => ({
      betId: b.id,
      userId: b.userId,
      username: b.user.username,
      amount: b.amount,
      autoCashoutAt: b.autoCashoutAt ? Number(b.autoCashoutAt.toString()) : null,
      cashedOutAt: b.cashedOutMultiplier
        ? Number(b.cashedOutMultiplier.toString())
        : null,
      payout: b.payout,
    }));
  }

  // ── per-round P&L + period rollups ───────────────────────────────────────

  /**
   * Per-round financial breakdown (most recent first). For each round:
   * total staked across all bettors, total paid out, house P/L
   * (staked − paid), bettor count. Cursor-paginated by roundNumber.
   */
  async adminRoundsPnl(limit = 50, beforeRoundNumber?: number) {
    const where: { status: 'CRASHED'; roundNumber?: { lt: number } } = {
      status: 'CRASHED',
    };
    if (beforeRoundNumber != null) where.roundNumber = { lt: beforeRoundNumber };

    const rounds = await this.prisma.aviatorRound.findMany({
      where,
      orderBy: { roundNumber: 'desc' },
      take: Math.min(500, Math.max(1, limit)),
      select: {
        id: true,
        roundNumber: true,
        crashMultiplier: true,
        crashedAt: true,
        startedAt: true,
      },
    });

    if (rounds.length === 0) return [];

    // One grouped aggregate covers every round in this page.
    const ids = rounds.map((r) => r.id);
    const grouped = await this.prisma.aviatorBet.groupBy({
      by: ['roundId'],
      where: { roundId: { in: ids } },
      _count: { _all: true },
      _sum: { amount: true, payout: true },
    });
    const byRound = new Map(grouped.map((g) => [g.roundId, g]));

    return rounds.map((r) => {
      const g = byRound.get(r.id);
      const staked = g?._sum.amount ?? 0;
      const paidOut = g?._sum.payout ?? 0;
      return {
        roundId: r.id,
        roundNumber: r.roundNumber,
        startedAt: r.startedAt.toISOString(),
        crashedAt: r.crashedAt?.toISOString() ?? null,
        crashMultiplier: r.crashMultiplier.toString(),
        bettorCount: g?._count._all ?? 0,
        totalStaked: staked,
        totalPaidOut: paidOut,
        houseProfit: staked - paidOut,
      };
    });
  }

  /**
   * Rollups of stake / payout / house P&L by period. Supports day,
   * month, and Indian fiscal year (Apr 1 – Mar 31). Aggregation is
   * done in SQL via Prisma's raw template, but we use a portable
   * approach: pull all CRASHED-round aggregates within the window
   * and group in memory. For year-scale windows on a busy game this
   * may want a Postgres `date_trunc` group-by, but at current
   * volumes (~1k–10k rounds/day) in-memory is fine and avoids a
   * coupling to SQL dialect.
   */
  async adminFinanceRollup(
    period: 'day' | 'month' | 'fy',
    limit = 30,
  ): Promise<
    {
      periodKey: string;
      periodLabel: string;
      periodStart: string;
      periodEnd: string;
      totalStaked: number;
      totalPaidOut: number;
      houseProfit: number;
      roundCount: number;
      bettorCount: number;
    }[]
  > {
    // Look-back windows tuned to keep the result set bounded.
    const lookbackMs =
      period === 'day'
        ? limit * 24 * 60 * 60 * 1000 // last N days
        : period === 'month'
          ? limit * 35 * 24 * 60 * 60 * 1000 // last N months-ish
          : limit * 366 * 24 * 60 * 60 * 1000; // last N FYs

    const since = new Date(Date.now() - lookbackMs);

    // Use crashedAt as the time anchor — that's when the round
    // realised. A round that crosses midnight is grouped in the
    // bucket of its crash time, which matches house-accounting
    // intuition.
    const rounds = await this.prisma.aviatorRound.findMany({
      where: { status: 'CRASHED', crashedAt: { gte: since } },
      select: { id: true, crashedAt: true },
    });
    if (rounds.length === 0) return [];

    const ids = rounds.map((r) => r.id);
    const bets = await this.prisma.aviatorBet.findMany({
      where: { roundId: { in: ids } },
      select: { roundId: true, userId: true, amount: true, payout: true },
    });

    // Map each round to its bucket key + bucket window.
    const buckets = new Map<
      string,
      {
        key: string;
        label: string;
        start: Date;
        end: Date;
        stake: number;
        paid: number;
        rounds: Set<string>;
        bettors: Set<string>;
      }
    >();

    function bucketFor(crashedAt: Date) {
      if (period === 'day') {
        const y = crashedAt.getUTCFullYear();
        const m = crashedAt.getUTCMonth();
        const d = crashedAt.getUTCDate();
        const start = new Date(Date.UTC(y, m, d));
        const end = new Date(Date.UTC(y, m, d + 1));
        const key = start.toISOString().slice(0, 10);
        return { key, label: key, start, end };
      }
      if (period === 'month') {
        const y = crashedAt.getUTCFullYear();
        const m = crashedAt.getUTCMonth();
        const start = new Date(Date.UTC(y, m, 1));
        const end = new Date(Date.UTC(y, m + 1, 1));
        const key = start.toISOString().slice(0, 7);
        return { key, label: key, start, end };
      }
      // Indian FY: Apr 1 of year Y → Mar 31 of year Y+1.
      const y = crashedAt.getUTCFullYear();
      const m = crashedAt.getUTCMonth();
      const fyStartYear = m >= 3 ? y : y - 1; // Jan–Mar belongs to prior FY
      const start = new Date(Date.UTC(fyStartYear, 3, 1));
      const end = new Date(Date.UTC(fyStartYear + 1, 3, 1));
      const key = `FY${(fyStartYear % 100).toString().padStart(2, '0')}-${((fyStartYear + 1) % 100).toString().padStart(2, '0')}`;
      return { key, label: key, start, end };
    }

    const roundIdToBucket = new Map<string, string>();
    for (const r of rounds) {
      if (!r.crashedAt) continue;
      const b = bucketFor(r.crashedAt);
      roundIdToBucket.set(r.id, b.key);
      let entry = buckets.get(b.key);
      if (!entry) {
        entry = {
          key: b.key,
          label: b.label,
          start: b.start,
          end: b.end,
          stake: 0,
          paid: 0,
          rounds: new Set(),
          bettors: new Set(),
        };
        buckets.set(b.key, entry);
      }
      entry.rounds.add(r.id);
    }
    for (const b of bets) {
      const key = roundIdToBucket.get(b.roundId);
      if (!key) continue;
      const entry = buckets.get(key)!;
      entry.stake += b.amount;
      entry.paid += b.payout ?? 0;
      entry.bettors.add(b.userId);
    }

    return Array.from(buckets.values())
      .sort((a, b) => b.start.getTime() - a.start.getTime())
      .slice(0, limit)
      .map((b) => ({
        periodKey: b.key,
        periodLabel: b.label,
        periodStart: b.start.toISOString(),
        periodEnd: b.end.toISOString(),
        totalStaked: b.stake,
        totalPaidOut: b.paid,
        houseProfit: b.stake - b.paid,
        roundCount: b.rounds.size,
        bettorCount: b.bettors.size,
      }));
  }

  // ── snapshot helpers ──────────────────────────────────────────────────────

  private snapshotPublicState() {
    if (!this.current) return { phase: this.phase };
    return {
      phase: this.phase,
      roundId: this.current.roundId,
      roundNumber: this.current.roundNumber,
      seedId: this.current.seedId,
      serverSeedHash: this.current.serverSeedHash,
      clientSeed: this.current.clientSeed,
      nonce: this.current.nonce,
      bettingEndsAt: this.phase === 'BETTING' ? this.bettingClosesAt : null,
      startedAt: this.phase === 'RUNNING' ? this.current.startedAt : null,
      multiplier:
        this.phase === 'RUNNING'
          ? Number(this.currentMultiplier.toFixed(2))
          : null,
    };
  }

  private publicRoster() {
    return Array.from(this.bets.values()).map((b) => ({
      username: b.username,
      amount: b.amount,
      autoCashoutAt: b.autoCashoutAt,
      cashedOutAt: b.cashedOutAt,
    }));
  }

  // ── Admin knob accessors ──────────────────────────────────────────────────

  /**
   * Read the admin's max-payout ceiling. Returns null when unset (the
   * default — uncapped). The ceiling is advisory only: round seeds are
   * still computed from the provably-fair RNG, the cap just clips the
   * published crash point.
   */
  private async readMaxPayout(): Promise<number | null> {
    const row = await this.prisma.aviatorSettings.findUnique({
      where: { id: 1 },
      select: { maxPayout: true },
    });
    if (!row?.maxPayout) return null;
    const n = Number(row.maxPayout.toString());
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /**
   * Atomically read-and-clear `forcedNextPayout`. The UPDATE … WHERE
   * forcedNextPayout IS NOT NULL guard means two concurrent phase
   * starts can't both consume the same value — only one UPDATE
   * matches a row, the other returns 0 affected rows and gets null.
   * Postgres provides this via Prisma's updateMany returning a count;
   * we follow up with a SELECT for the value we just nulled out.
   */
  private async consumeForcedNextPayout(): Promise<number | null> {
    const before = await this.prisma.aviatorSettings.findUnique({
      where: { id: 1 },
      select: { forcedNextPayout: true },
    });
    if (!before?.forcedNextPayout) return null;
    const result = await this.prisma.aviatorSettings.updateMany({
      where: { id: 1, forcedNextPayout: { not: null } },
      data: { forcedNextPayout: null },
    });
    if (result.count === 0) return null;
    const n = Number(before.forcedNextPayout.toString());
    return Number.isFinite(n) && n >= 1 ? n : null;
  }

  /**
   * Read the current admin knobs (for the admin UI to render). Lazily
   * creates the singleton row if a previous deploy somehow missed the
   * migration's seed insert.
   */
  async getAdminSettings() {
    const row = await this.prisma.aviatorSettings.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });
    return {
      maxPayout: row.maxPayout?.toString() ?? null,
      forcedNextPayout: row.forcedNextPayout?.toString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Patch one or both admin knobs. Each field is optional — omit to
   * leave unchanged, send `null` to clear, send a string decimal to
   * set. Validation: positive numbers, fixed-payout >= 1.00 since the
   * crash multiplier can never go below 1.
   */
  async updateAdminSettings(input: {
    maxPayout?: string | null;
    forcedNextPayout?: string | null;
  }) {
    const data: { maxPayout?: string | null; forcedNextPayout?: string | null } = {};
    if (input.maxPayout !== undefined) {
      if (input.maxPayout === null || input.maxPayout === '') {
        data.maxPayout = null;
      } else {
        const n = Number(input.maxPayout);
        if (!Number.isFinite(n) || n < 1) {
          throw new BadRequestException(
            'maxPayout must be ≥ 1.00 (or omit/null to clear)',
          );
        }
        data.maxPayout = n.toFixed(2);
      }
    }
    if (input.forcedNextPayout !== undefined) {
      if (input.forcedNextPayout === null || input.forcedNextPayout === '') {
        data.forcedNextPayout = null;
      } else {
        const n = Number(input.forcedNextPayout);
        if (!Number.isFinite(n) || n < 1) {
          throw new BadRequestException(
            'forcedNextPayout must be ≥ 1.00 (or omit/null to clear)',
          );
        }
        data.forcedNextPayout = n.toFixed(2);
      }
    }
    await this.prisma.aviatorSettings.upsert({
      where: { id: 1 },
      update: data,
      create: { id: 1, ...data },
    });
    return this.getAdminSettings();
  }
}

/** Bucket crash multipliers into log-ish bands for the analytics chart. */
function bucketHistogram(values: number[]) {
  const buckets = [
    { label: '<1.20', max: 1.2 },
    { label: '1.20–1.50', max: 1.5 },
    { label: '1.50–2.00', max: 2.0 },
    { label: '2.00–3.00', max: 3.0 },
    { label: '3.00–5.00', max: 5.0 },
    { label: '5.00–10.00', max: 10.0 },
    { label: '≥10.00', max: Number.POSITIVE_INFINITY },
  ];
  const counts = buckets.map(() => 0);
  for (const v of values) {
    const idx = buckets.findIndex((b) => v < b.max);
    counts[idx === -1 ? buckets.length - 1 : idx]++;
  }
  return buckets.map((b, i) => ({ label: b.label, count: counts[i] }));
}
