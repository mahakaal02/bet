import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { BetWalletService } from '../bet-wallet/bet-wallet.service';
import { AviatorState } from './aviator-state';
import { AviatorGateway } from './aviator.gateway';
import { AviatorKnobsService } from './aviator-knobs.service';
import { BetSettlementService } from './bet-settlement.service';
import { RoundLifecycleService } from './round-lifecycle.service';
import { AviatorAnalyticsService } from './aviator-analytics.service';

/**
 * AviatorService — composition root for the Aviator game (PR-ARCH-AUDIT,
 * Stage B).
 *
 * Historically a 1,412-line god-class that owned: socket.io server +
 * JWT auth, round state machine, bet placement, cashout settlement,
 * fairness orchestration, payout cap, statistics, finance rollups,
 * admin knobs, and chat relay. Tests-on-pure-math but ZERO tests on
 * service-level orchestration.
 *
 * After the split:
 *   - AviatorState              — shared mutable game-loop state
 *   - AviatorGateway            — Socket.IO server + auth + chat
 *   - AviatorKnobsService       — admin maxPayout / forcedNextPayout
 *   - BetSettlementService      — placeBet / cashout / cashoutInternal
 *   - RoundLifecycleService     — BETTING/RUNNING/CRASHED state machine
 *   - AviatorAnalyticsService   — every read-only stats endpoint
 *
 * This class keeps the EXACT public surface the controllers (and
 * other modules) consumed before the split, so neither the
 * AviatorController nor AdminController need to change. Each public
 * method delegates to the right sub-service.
 */
@Injectable()
export class AviatorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AviatorService.name);

  constructor(
    private readonly state: AviatorState,
    private readonly gateway: AviatorGateway,
    private readonly knobs: AviatorKnobsService,
    private readonly settlement: BetSettlementService,
    private readonly lifecycle: RoundLifecycleService,
    private readonly analytics: AviatorAnalyticsService,
    private readonly betWallet: BetWalletService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.gateway.attach();
    await this.lifecycle.bootstrap();
    void this.lifecycle.startBettingPhase();
  }

  onModuleDestroy(): void {
    this.state.clearTimers();
    // AviatorGateway implements OnModuleDestroy itself; Nest closes
    // the io server. No need to double-close here.
  }

  // ── Public REST surface (called by AviatorController) ──────────────────

  /**
   * Live coin balance from Bet (the unified wallet authority). We
   * surface errors rather than fall back to a stale local read —
   * a "₹0 because Bet was down" reading is worse than an explicit
   * error the client can retry on.
   */
  async getBalance(userId: string): Promise<number> {
    return this.betWallet.balance(userId);
  }

  placeBet(
    userId: string,
    username: string,
    amount: number,
    autoCashoutAt: number | null,
  ) {
    return this.settlement.placeBet(userId, username, amount, autoCashoutAt);
  }

  cashout(userId: string) {
    return this.settlement.cashout(userId);
  }

  recentRounds(limit?: number) {
    return this.analytics.recentRounds(limit);
  }

  getUserStats(userId: string, range: 'day' | 'week' | 'month' | 'all') {
    return this.analytics.getUserStats(userId, range);
  }

  // ── Admin surface (called by AdminController) ──────────────────────────

  adminRoundLog(limit?: number, beforeRoundNumber?: number) {
    return this.analytics.adminRoundLog(limit, beforeRoundNumber);
  }

  adminAnalytics(hours?: number) {
    return this.analytics.adminAnalytics(hours);
  }

  adminCurrentRound() {
    return this.analytics.adminCurrentRound();
  }

  adminCurrentRoundBets() {
    return this.analytics.adminCurrentRoundBets();
  }

  adminRoundsPnl(limit?: number, beforeRoundNumber?: number) {
    return this.analytics.adminRoundsPnl(limit, beforeRoundNumber);
  }

  adminFinanceRollup(period: 'day' | 'month' | 'fy', limit?: number) {
    return this.analytics.adminFinanceRollup(period, limit);
  }

  rotateSeed(reason: 'scheduled' | 'admin' | 'max_rounds') {
    return this.lifecycle.rotateSeed(reason);
  }

  getAdminSettings() {
    return this.knobs.getAdminSettings();
  }

  updateAdminSettings(input: {
    maxPayout?: string | null;
    forcedNextPayout?: string | null;
  }) {
    return this.knobs.updateAdminSettings(input);
  }
}
