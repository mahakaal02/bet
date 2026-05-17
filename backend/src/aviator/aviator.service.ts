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
    const crashMultiplier = computeCrashMultiplier(seed.serverSeed, seed.clientSeed, nonce);

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

  private async cashoutInternal(bet: ActiveBet, multiplier: number) {
    if (bet.cashedOutAt !== null) return null;
    bet.cashedOutAt = multiplier;
    const payout = Math.floor(
      new Decimal(bet.amount).times(multiplier).toNumber(),
    );

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
    await this.prisma.aviatorBet.update({
      where: { id: bet.betId },
      data: {
        cashedOutAt: new Date(),
        cashedOutMultiplier: multiplier.toFixed(2),
        payout: betWalletOk ? payout : 0,
      },
    });

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
    this.io.emit('PLAYER_CASHOUT', winner);

    return { multiplier, payout };
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
