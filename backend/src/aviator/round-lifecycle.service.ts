import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../foundation/settings.service';
import { FairnessStore } from './fairness-store';
import { CrashDistributionService } from './crash/crash-distribution.service';
import { computeCrashMultiplier, multiplierAt } from './fairness';
import { loadCapConfig, isCapActive, capMultiplier } from './payout-cap';
import { AviatorState } from './aviator-state';
import { AviatorGateway } from './aviator.gateway';
import { AviatorKnobsService } from './aviator-knobs.service';
import { BetSettlementService } from './bet-settlement.service';

const BETTING_MS = 10_000;
const CRASH_HOLD_MS = 3_000;
const TICK_MS = 100;

/**
 * Round state machine for Aviator (PR-ARCH-AUDIT, Stage B — extracted
 * from the AviatorService god-class).
 *
 * Drives BETTING → RUNNING → CRASHED → BETTING using setTimeout +
 * setInterval. Cap-triggered + auto-target cashouts are delegated to
 * BetSettlementService.cashoutInternal so the settlement logic stays
 * in one place.
 *
 * Lifecycle is owned by AviatorService (the composition root) which
 * calls `bootstrap()` then `startBettingPhase()` on app boot, and
 * relies on AviatorGateway/State's destroy hooks for cleanup. The
 * timers are NOT @Cron — they are state-machine-driven, so adding
 * @Cron would race the existing setTimeouts.
 *
 * Single-replica only — the in-memory `state` cannot be shared
 * across pods. Distributed-state migration is a separate roadmap
 * item (audit P1-4). For now, deploy Aviator with `replicas: 1`.
 */
@Injectable()
export class RoundLifecycleService {
  private readonly logger = new Logger(RoundLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly fairness: FairnessStore,
    private readonly crashEngine: CrashDistributionService,
    private readonly state: AviatorState,
    private readonly gateway: AviatorGateway,
    private readonly knobs: AviatorKnobsService,
    private readonly settlement: BetSettlementService,
  ) {}

  /**
   * Mark rounds that were in BETTING/RUNNING when the previous
   * process died as CRASHED so they don't haunt the live view.
   * Restore `lastRoundNumber` and `roundsUsedInCurrentSeed` from
   * the persisted state.
   */
  async bootstrap(): Promise<void> {
    const orphaned = await this.prisma.aviatorRound.updateMany({
      where: { status: { in: ['BETTING', 'RUNNING'] } },
      data: { status: 'CRASHED', crashedAt: new Date() },
    });
    if (orphaned.count > 0) {
      this.logger.warn(
        `marked ${orphaned.count} orphaned round(s) CRASHED on bootstrap`,
      );
    }

    const last = await this.prisma.aviatorRound.findFirst({
      orderBy: { roundNumber: 'desc' },
      select: { roundNumber: true, seedId: true },
    });
    this.state.lastRoundNumber = last?.roundNumber ?? 0;

    if (last?.seedId) {
      this.state.roundsUsedInCurrentSeed =
        await this.prisma.aviatorRound.count({
          where: { seedId: last.seedId },
        });
    }
  }

  async startBettingPhase(): Promise<void> {
    this.state.phase = 'BETTING';
    this.state.bets.clear();
    this.state.currentMultiplier = 1.0;

    if (this.fairness.shouldAutoRotate(this.state.roundsUsedInCurrentSeed)) {
      await this.rotateSeed('max_rounds');
    }

    const seed = await this.fairness.getOrCreateActive(
      this.state.lastRoundNumber,
    );

    let roundNumber = this.state.lastRoundNumber + 1;
    const nonce = this.state.roundsUsedInCurrentSeed + 1;

    // Heavy-tail engine has first refusal. When enabled, it reads
    // the same seed batch (different HMAC domain → no cryptographic
    // overlap) and produces a multiplier whose distribution matches
    // the configured RTP / bucket targets. Refreshing config every
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

    const forced = await this.knobs.consumeForcedNextPayout();
    const ceiling = await this.knobs.readMaxPayout();
    let crashMultiplier = forced !== null ? forced : naturalCrash;
    if (ceiling !== null && crashMultiplier > ceiling) {
      crashMultiplier = ceiling;
    }
    if (crashMultiplier < 1) crashMultiplier = 1;

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
      } catch (e: unknown) {
        const code = (e as { code?: string })?.code;
        if (code !== 'P2002') throw e;
        roundNumber++;
      }
    }
    if (!row) throw new Error('could not allocate round number after retries');

    this.state.lastRoundNumber = roundNumber;
    this.state.roundsUsedInCurrentSeed++;
    await this.fairness.markStartRound(seed.id, roundNumber);

    const payoutCap = await loadCapConfig(this.settings);

    this.state.current = {
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
    this.state.bettingClosesAt = Date.now() + BETTING_MS;

    this.gateway.emit('GAME_START', {
      roundId: row.id,
      roundNumber,
      seedId: seed.id,
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonce,
      bettingEndsAt: this.state.bettingClosesAt,
    });

    this.state.phaseTimer = setTimeout(
      () => void this.startRunningPhase(),
      BETTING_MS,
    );
  }

  private async startRunningPhase(): Promise<void> {
    if (!this.state.current) return;
    this.state.phase = 'RUNNING';
    this.state.current.startedAt = Date.now();
    await this.prisma.aviatorRound.update({
      where: { id: this.state.current.roundId },
      data: { status: 'RUNNING', startedAt: new Date(this.state.current.startedAt) },
    });
    this.gateway.emit('GAME_RUNNING', {
      roundId: this.state.current.roundId,
      startedAt: this.state.current.startedAt,
    });

    this.state.tickTimer = setInterval(() => void this.tick(), TICK_MS);
  }

  private async tick(): Promise<void> {
    if (!this.state.current || this.state.phase !== 'RUNNING') return;
    const elapsed = Date.now() - this.state.current.startedAt;
    this.state.currentMultiplier = multiplierAt(elapsed);

    // Cap-triggered auto-cashout: for each live bet, the moment the
    // live multiplier crosses capMultiplier(stake, capCoins), settle
    // at EXACTLY that multiplier (not the current tick's, which may
    // have overshot by up to 100 ms). Run BEFORE the autoCashoutAt
    // loop so a player whose chosen target is ABOVE their cap line
    // still gets the cap-triggered settlement.
    if (
      this.state.current.payoutCap &&
      isCapActive(this.state.current.payoutCap)
    ) {
      const cap = this.state.current.payoutCap.maxCoins;
      for (const bet of this.state.bets.values()) {
        if (bet.cashedOutAt !== null) continue;
        const lineM = capMultiplier(bet.amount, cap);
        if (this.state.currentMultiplier >= lineM) {
          await this.settlement.cashoutInternal(bet, lineM, { reason: 'cap' });
        }
      }
    }

    for (const bet of this.state.bets.values()) {
      if (
        bet.cashedOutAt === null &&
        bet.autoCashoutAt !== null &&
        this.state.currentMultiplier >= bet.autoCashoutAt
      ) {
        await this.settlement.cashoutInternal(bet, bet.autoCashoutAt, {
          reason: 'auto',
        });
      }
    }

    if (this.state.currentMultiplier >= this.state.current.crashMultiplier) {
      await this.crashRound();
      return;
    }

    this.gateway.emit('MULTIPLIER_UPDATE', {
      multiplier: Number(this.state.currentMultiplier.toFixed(2)),
      elapsed,
    });
  }

  private async crashRound(): Promise<void> {
    if (!this.state.current) return;
    this.state.phase = 'CRASHED';
    if (this.state.tickTimer) {
      clearInterval(this.state.tickTimer);
      this.state.tickTimer = null;
    }
    const crashedAt = new Date();
    await this.prisma.aviatorRound.update({
      where: { id: this.state.current.roundId },
      data: { status: 'CRASHED', crashedAt },
    });

    // EMA observation: sum each cashed-out bet at its locked-in
    // multiplier; un-cashed bets contribute 0 (their stake is house
    // revenue). Uses Decimal so the EMA tracker sees exact totals
    // even at large stakes × multipliers — this path is for the
    // crash engine's adaptive feedback, not for crediting wallets.
    let totalStake = 0;
    let totalPayoutDec = new Decimal(0);
    for (const bet of this.state.bets.values()) {
      totalStake += bet.amount;
      if (bet.cashedOutAt !== null) {
        totalPayoutDec = totalPayoutDec.plus(
          new Decimal(bet.amount).times(bet.cashedOutAt).floor(),
        );
      }
    }
    this.crashEngine.observeRoundOutcome({
      stake: totalStake,
      payout: totalPayoutDec.toNumber(),
      bettors: this.state.bets.size,
    });

    this.gateway.emit('GAME_CRASH', {
      roundId: this.state.current.roundId,
      roundNumber: this.state.current.roundNumber,
      crashMultiplier: this.state.current.crashMultiplier,
      // Per-round seed reveal is preserved for existing clients;
      // proper verification now uses the seed-batch reveal at
      // rotation time.
      serverSeed: this.state.current.serverSeed,
      clientSeed: this.state.current.clientSeed,
      nonce: this.state.current.nonce,
    });

    this.state.phaseTimer = setTimeout(
      () => void this.startBettingPhase(),
      CRASH_HOLD_MS,
    );
  }

  async rotateSeed(reason: 'scheduled' | 'admin' | 'max_rounds') {
    const result = await this.fairness.rotate(reason, this.state.lastRoundNumber);
    this.state.roundsUsedInCurrentSeed = 0;
    this.gateway.emit('SEED_ROTATED', {
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
}
