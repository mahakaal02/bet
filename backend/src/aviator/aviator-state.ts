import { Injectable } from '@nestjs/common';
import type { GenerateResult } from './crash/crash-distribution.service';
import type { PayoutCapConfig } from './payout-cap';

/**
 * Game-loop phase. The state machine is owned by
 * RoundLifecycleService; everything else reads `phase` to gate
 * actions (placeBet → BETTING only, cashout → RUNNING only).
 */
export type Phase = 'BETTING' | 'RUNNING' | 'CRASHED';

export interface ActiveBet {
  betId: string;
  userId: string;
  username: string;
  amount: number;
  autoCashoutAt: number | null;
  cashedOutAt: number | null;
}

export interface CurrentRoundState {
  roundId: string;
  roundNumber: number;
  seedId: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  crashMultiplier: number;
  startedAt: number;
  engine: GenerateResult | null;
  payoutCap: PayoutCapConfig;
}

export interface RecentWinner {
  username: string;
  multiplier: number;
  payout: number;
  roundNumber: number;
  at: number;
}

const RECENT_WINNERS_LIMIT = 20;

/**
 * Shared mutable game-loop state (PR-ARCH-AUDIT, Stage B).
 *
 * Pulled out of the old AviatorService god-class so the round
 * lifecycle, bet settlement, and analytics services can share one
 * source of truth without circular DI. Injectable singleton — Nest
 * gives each consumer the same instance.
 *
 * NOT thread-safe; relies on Node's single-threaded event loop. All
 * mutations happen on the main loop tick or in handler bodies.
 */
@Injectable()
export class AviatorState {
  phase: Phase = 'BETTING';
  current: CurrentRoundState | null = null;
  bets = new Map<string, ActiveBet>();
  currentMultiplier = 1.0;
  bettingClosesAt = 0;
  lastRoundNumber = 0;
  roundsUsedInCurrentSeed = 0;
  recentWinners: RecentWinner[] = [];
  tickTimer: NodeJS.Timeout | null = null;
  phaseTimer: NodeJS.Timeout | null = null;

  clearTimers(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.phaseTimer) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
  }

  pushRecentWinner(w: RecentWinner): void {
    this.recentWinners.unshift(w);
    if (this.recentWinners.length > RECENT_WINNERS_LIMIT) {
      this.recentWinners.length = RECENT_WINNERS_LIMIT;
    }
  }

  /**
   * Public, redacted view of the round used by the gateway's
   * STATE_SNAPSHOT and by analytics responses. Never includes
   * other players' identities or amounts.
   */
  snapshotPublic() {
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

  /**
   * Per-player roster of the live round. Same shape STATE_SNAPSHOT
   * publishes on socket connection — broadcasts identity (username
   * only), stake, auto-cashout target, and post-cashout multiplier.
   */
  publicRoster() {
    return Array.from(this.bets.values()).map((b) => ({
      username: b.username,
      amount: b.amount,
      autoCashoutAt: b.autoCashoutAt,
      cashedOutAt: b.cashedOutAt,
    }));
  }
}
