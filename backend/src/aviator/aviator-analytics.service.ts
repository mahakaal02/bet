import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AviatorState } from './aviator-state';
import { AviatorGateway } from './aviator.gateway';
import { reportingPayout } from './bet-settlement.service';

/**
 * Read-only analytics + admin reporting for Aviator (PR-ARCH-AUDIT,
 * Stage B — extracted from the AviatorService god-class).
 *
 * Every method here is a query — no state mutation, no wallet
 * touches. Safe to call when the game loop is paused.
 */
@Injectable()
export class AviatorAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: AviatorState,
    private readonly gateway: AviatorGateway,
  ) {}

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
   * Paginated round log for the admin dashboard. Each row carries
   * enough to reconstruct an audit timeline.
   */
  async adminRoundLog(limit = 100, beforeRoundNumber?: number) {
    const where: { status: 'CRASHED'; roundNumber?: { lt: number } } = {
      status: 'CRASHED',
    };
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

  /**
   * Player's own performance summary for a rolling window. UTC anchor.
   *
   *   day   → last 24h
   *   week  → last 7d
   *   month → last 30d
   *   all   → since account creation
   */
  async getUserStats(userId: string, range: 'day' | 'week' | 'month' | 'all') {
    const lookbackMs =
      range === 'day'
        ? 24 * 60 * 60 * 1000
        : range === 'week'
          ? 7 * 24 * 60 * 60 * 1000
          : range === 'month'
            ? 30 * 24 * 60 * 60 * 1000
            : null;
    const since = lookbackMs ? new Date(Date.now() - lookbackMs) : null;
    const where = {
      userId,
      ...(since ? { createdAt: { gte: since } } : {}),
    };

    const [agg, topBets] = await Promise.all([
      this.prisma.aviatorBet.aggregate({
        where,
        _count: { _all: true },
        _sum: { amount: true, payout: true },
      }),
      this.prisma.aviatorBet.findMany({
        where,
        select: {
          amount: true,
          payout: true,
          cashedOutMultiplier: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ]);

    const totalBets = agg._count._all;
    const totalStaked = agg._sum.amount ?? 0;
    const totalPayout = agg._sum.payout ?? 0;
    const netProfit = totalPayout - totalStaked;
    const wins = topBets.filter((b) => b.cashedOutMultiplier !== null).length;
    const winRate = totalBets > 0 ? wins / totalBets : 0;

    let biggestMultiplier = 0;
    let biggestWin = 0;
    for (const b of topBets) {
      const m =
        b.cashedOutMultiplier != null
          ? Number(b.cashedOutMultiplier.toString())
          : 0;
      if (m > biggestMultiplier) biggestMultiplier = m;
      const p = b.payout ?? 0;
      if (p > biggestWin) biggestWin = p;
    }

    return {
      range,
      since: since ? since.toISOString() : null,
      totalBets,
      wins,
      losses: totalBets - wins,
      winRate,
      totalStaked,
      totalPayout,
      netProfit,
      biggestMultiplier,
      biggestWin,
    };
  }

  /**
   * Aggregate stats over the last [hours] hours. Read-only and
   * DB-only (no game-loop state) so it runs even when the loop is
   * paused.
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
      onlineCount: this.gateway.getOnlineCount(),
      currentPhase: this.state.phase,
      currentRoundNumber: this.state.current?.roundNumber ?? null,
    };
  }

  /**
   * Snapshot of the round running right now. Two distinct user counts:
   *   - onlineCount     : socket connections (passive viewers too).
   *   - bettorsThisRound: distinct users with a bet on the current round.
   */
  async adminCurrentRound() {
    const phase = this.state.phase;
    const current = this.state.current;
    const onlineCount = this.gateway.getOnlineCount();

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
      for (const b of this.state.bets.values()) {
        totalStaked += b.amount;
        if (b.cashedOutAt !== null) {
          totalPaidOut += reportingPayout(b.amount, b.cashedOutAt);
        }
      }
      bettorsThisRound = this.state.bets.size;
    } else {
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
      startedAt:
        current.startedAt > 0 ? new Date(current.startedAt).toISOString() : null,
      crashMultiplier: current.crashMultiplier,
      onlineCount,
      bettorsThisRound,
      totalStaked,
      totalPaidOut,
    };
  }

  /**
   * Per-user bets on the current round — admin drill-down view.
   * Serves from the in-memory map during BETTING/RUNNING, from
   * persisted rows otherwise.
   */
  async adminCurrentRoundBets() {
    const current = this.state.current;
    if (!current) return [];

    if (this.state.phase === 'BETTING' || this.state.phase === 'RUNNING') {
      return Array.from(this.state.bets.values()).map((b) => ({
        betId: b.betId,
        userId: b.userId,
        username: b.username,
        amount: b.amount,
        autoCashoutAt: b.autoCashoutAt,
        cashedOutAt: b.cashedOutAt,
        payout: b.cashedOutAt !== null ? reportingPayout(b.amount, b.cashedOutAt) : null,
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

  /**
   * Per-round financial breakdown (most recent first). Cursor-paginated
   * by roundNumber.
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
   * Rollups by period (day / month / Indian fiscal year). In-memory
   * grouping; at current volumes (~1k–10k rounds/day) this avoids a
   * SQL-dialect coupling.
   */
  async adminFinanceRollup(period: 'day' | 'month' | 'fy', limit = 30) {
    const lookbackMs =
      period === 'day'
        ? limit * 24 * 60 * 60 * 1000
        : period === 'month'
          ? limit * 35 * 24 * 60 * 60 * 1000
          : limit * 366 * 24 * 60 * 60 * 1000;
    const since = new Date(Date.now() - lookbackMs);

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
      const fyStartYear = m >= 3 ? y : y - 1;
      const start = new Date(Date.UTC(fyStartYear, 3, 1));
      const end = new Date(Date.UTC(fyStartYear + 1, 3, 1));
      const key = `FY${(fyStartYear % 100)
        .toString()
        .padStart(2, '0')}-${((fyStartYear + 1) % 100).toString().padStart(2, '0')}`;
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
