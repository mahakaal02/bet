import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { SettingsService } from '../../foundation/settings.service';
import {
  DEFAULT_PARAMS,
  DistributionParams,
  bucketProbabilities,
  clampParams,
  rtpBreakdown,
} from './distribution';
import { computeHeavyTailCrash } from './engine';
import {
  DEFAULT_TRACKER_CFG,
  ExposureTracker,
  MODE_PRESETS,
  VolatilityMode,
  adaptiveParams,
} from './modes';

/**
 * Crash-distribution orchestrator.
 *
 * One injectable, one job: given the next round's (serverSeed,
 * clientSeed, nonce), return a (multiplier, audit) tuple that the
 * `AviatorService` round scheduler can persist.
 *
 *   - Reads every knob from `SettingsService` (env fallback then
 *     hard default — same three-tier pattern as the rest of the
 *     codebase).
 *   - Resolves the active volatility mode + smoothed exposure factor.
 *   - Blends BALANCED with the directional preset; RTP at C_ref is
 *     structurally locked by the distribution math so the publicly
 *     advertised RTP holds across every blend.
 *   - Hands the seed + params to the pure-math engine.
 *   - Emits a single structured audit log line capturing every input
 *     (so the round's `crashMultiplier` is reproducible offline).
 *
 * Disabled-by-default: when `aviator.crash.engine` is anything other
 * than `'heavytail'`, the service returns `null` and the calling
 * scheduler falls back to the existing `computeCrashMultiplier`.
 */
@Injectable()
export class CrashDistributionService implements OnModuleInit {
  private readonly logger = new Logger(CrashDistributionService.name);

  private tracker = new ExposureTracker(DEFAULT_TRACKER_CFG);

  // Cached config; refreshed each round (cheap — Settings cache TTL is 60s).
  private targetRtp = DEFAULT_PARAMS.rtp;
  private adaptiveEnabled = true;
  private baseMode: VolatilityMode = 'BALANCED';
  private engineEnabled = false;

  constructor(private readonly settings: SettingsService) {}

  async onModuleInit() {
    await this.refreshConfig();
    this.logger.log(
      `crash-engine config: enabled=${this.engineEnabled} ` +
        `rtp=${this.targetRtp} mode=${this.baseMode} adaptive=${this.adaptiveEnabled}`,
    );
  }

  /**
   * Pulls the latest config snapshot from `SettingsService`. Each
   * setter is `key → env → hard default`, matching the foundation
   * pattern. Tolerant of partial config — any missing knob falls
   * back to the engine default.
   */
  async refreshConfig(): Promise<void> {
    const engine = await this.settings.getString('aviator.crash.engine', 'legacy');
    this.engineEnabled = engine.toLowerCase() === 'heavytail';

    this.targetRtp = await this.settings.getFloat(
      'aviator.crash.rtp',
      DEFAULT_PARAMS.rtp,
    );
    this.adaptiveEnabled = await this.settings.getBool(
      'aviator.crash.adaptive_enabled',
      true,
    );

    const mode = (
      await this.settings.getString('aviator.crash.mode', 'balanced')
    ).toUpperCase() as VolatilityMode;
    this.baseMode = (
      mode === 'FAST_LOSS' || mode === 'STREAMER' ? mode : 'BALANCED'
    ) as VolatilityMode;

    const alpha = await this.settings.getFloat(
      'aviator.crash.alpha',
      DEFAULT_TRACKER_CFG.alpha,
    );
    const blendStrength = await this.settings.getFloat(
      'aviator.crash.blend_strength',
      DEFAULT_TRACKER_CFG.blendStrength,
    );
    const referenceStake = await this.settings.getInt(
      'aviator.crash.reference_stake',
      DEFAULT_TRACKER_CFG.referenceStake,
    );
    this.tracker = new ExposureTracker({
      alpha,
      blendStrength,
      referenceStake,
      factorMin: DEFAULT_TRACKER_CFG.factorMin,
      factorMax: DEFAULT_TRACKER_CFG.factorMax,
    });
  }

  /** Toggle helper for unit tests + simulation. */
  setEngineEnabledForTesting(enabled: boolean): void {
    this.engineEnabled = enabled;
  }

  /** True iff the heavy-tail engine should produce the next round. */
  isEnabled(): boolean {
    return this.engineEnabled;
  }

  /**
   * Generate the next round's crash multiplier and return a fully
   * auditable record. Returns `null` when the engine is disabled —
   * the caller must fall back to the legacy `computeCrashMultiplier`.
   */
  generate(input: {
    serverSeed: string;
    clientSeed: string;
    nonce: number;
  }): GenerateResult | null {
    if (!this.engineEnabled) return null;

    const baseParams = this.baseParamsForMode(this.baseMode);
    // Override the operator's chosen RTP onto the preset — preset RTPs
    // are seeded with the engine default and must follow the runtime
    // configured value.
    const tunedBase: DistributionParams = clampParams({
      ...baseParams,
      rtp: this.targetRtp,
    });
    const adapted = this.adaptiveEnabled
      ? this.applyAdaptation(tunedBase)
      : { params: tunedBase, mode: this.baseMode, factor: 0 };

    const params = clampParams(adapted.params);

    const multiplier = computeHeavyTailCrash(
      input.serverSeed,
      input.clientSeed,
      input.nonce,
      params,
    );

    return {
      multiplier,
      params,
      mode: adapted.mode,
      exposureFactor: adapted.factor,
      targetRtp: this.targetRtp,
      paramsHash: hashParams(params),
    };
  }

  /**
   * Record a round's realised result. Must be called AFTER the round
   * settles (cashouts known) so the rolling EMA reflects realised
   * payouts, not committed stakes.
   */
  observeRoundOutcome(round: {
    stake: number;
    payout: number;
    bettors: number;
  }): void {
    this.tracker.record(round);
  }

  /** Diagnostic — exposed by the admin endpoint. */
  snapshot() {
    const baseParams = this.baseParamsForMode(this.baseMode);
    const tunedBase: DistributionParams = clampParams({
      ...baseParams,
      rtp: this.targetRtp,
    });
    const adapted = this.adaptiveEnabled
      ? this.applyAdaptation(tunedBase)
      : { params: tunedBase, mode: this.baseMode, factor: 0 };
    const params = clampParams(adapted.params);
    const rtpBands = rtpBreakdown(params);
    return {
      engineEnabled: this.engineEnabled,
      adaptiveEnabled: this.adaptiveEnabled,
      baseMode: this.baseMode,
      activeMode: adapted.mode,
      exposureFactor: adapted.factor,
      targetRtp: this.targetRtp,
      analyticRtpAtRef: rtpBands.atRef,
      rtpBands,
      params,
      exposure: this.tracker.snapshot(),
      buckets: bucketProbabilities(params),
    };
  }

  // ────────────────────────────────────────────────────────────────

  private baseParamsForMode(mode: VolatilityMode): DistributionParams {
    return { ...(MODE_PRESETS[mode] ?? DEFAULT_PARAMS) };
  }

  private applyAdaptation(base: DistributionParams) {
    const exposure = this.tracker.exposureFactor();
    const driftCorrection = this.tracker.rtpDriftFactor(this.targetRtp);
    const factor = Math.max(-1, Math.min(1, exposure + driftCorrection));
    const { params, mode } = adaptiveParams(base, factor);
    return { params, mode, factor };
  }
}

export interface GenerateResult {
  multiplier: number;
  params: DistributionParams;
  mode: VolatilityMode;
  exposureFactor: number;
  targetRtp: number;
  paramsHash: string;
}

function hashParams(params: DistributionParams): string {
  const blob = JSON.stringify(params, Object.keys(params).sort());
  return createHash('sha256').update(blob).digest('hex').slice(0, 8);
}
