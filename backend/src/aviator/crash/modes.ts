/**
 * Volatility modes + adaptive exposure blending.
 * ===============================================
 *
 * Pure math + a tiny stateful EMA tracker. No I/O.
 *
 *   BALANCED — the heavy-tail baseline targeting the PDF's "feels right"
 *              histogram (~35% under 1.20x, ~3% ≥ 10x).
 *   FAST_LOSS — high-exposure / house-protection bias: more insta-crashes
 *               and a heavier bias band so more rounds finish before 1.50x.
 *   STREAMER  — low-exposure / promotional bias: fewer insta-crashes,
 *               fatter tail (lower k) to manufacture screenshot moments.
 *
 * For every mode the RTP at the canonical cashout `cRef` is structurally
 * locked by the engine — only the bucket shape changes. See
 * `distribution.ts` for the math.
 *
 * The "adaptive" piece is `blendDistributions`: linearly interpolates
 * between two presets by a scalar `t ∈ [0, 1]`. The orchestrator
 * (`crash-distribution.service.ts`) maps the smoothed exposure factor
 * into a (preset, t) pair and asks `blendDistributions` to mix.
 */

import {
  DEFAULT_PARAMS,
  DistributionParams,
  clampParams,
} from './distribution';

export type VolatilityMode = 'BALANCED' | 'FAST_LOSS' | 'STREAMER';

/**
 * Per-mode parameter presets.
 *
 *   FAST_LOSS — heavier bias mass (more early crashes), thinner tail.
 *               Brief target: <1.20x ≈ 45%, ≥10x < 1%.
 *   STREAMER  — lighter bias mass, fatter tail (k<1).
 *               Brief target: <1.20x ≈ 28%, ≥10x ≈ 5%.
 *
 * Every preset publishes the SAME `rtp` so the strategy-invariant
 * operator edge is mode-independent. The bucket shape shifts via
 * `bias` + `k`.
 */
export const MODE_PRESETS: Record<VolatilityMode, DistributionParams> = {
  BALANCED: { ...DEFAULT_PARAMS },
  FAST_LOSS: {
    rtp: DEFAULT_PARAMS.rtp,
    bias: 0.30,
    biasUpper: 1.5,
    k: 1.2,
    cRef: DEFAULT_PARAMS.cRef,
    maxMultiplier: 1_000,
  },
  STREAMER: {
    rtp: DEFAULT_PARAMS.rtp,
    bias: 0.08,
    biasUpper: 1.5,
    k: 0.85,
    cRef: DEFAULT_PARAMS.cRef,
    maxMultiplier: 10_000,
  },
};

/**
 * Linearly blend two parameter sets. Used to interpolate between
 * BALANCED and a directional preset based on the smoothed exposure
 * factor.
 *
 *   t = 0 → returns `from`
 *   t = 1 → returns `to`
 *
 * RTP and `cRef` are NOT blended directly — they're held constant at
 * the `from` value so the operator's published RTP never shifts due to
 * exposure adaptation. Only `bias`, `biasUpper`, `k`, `maxMultiplier`
 * interpolate.
 */
export function blendDistributions(
  from: DistributionParams,
  to: DistributionParams,
  tRaw: number,
): DistributionParams {
  const t = Math.max(0, Math.min(1, tRaw));
  const mix = (a: number, b: number) => a + (b - a) * t;
  return clampParams({
    rtp: from.rtp,
    bias: mix(from.bias, to.bias),
    biasUpper: mix(from.biasUpper, to.biasUpper),
    k: mix(from.k, to.k),
    cRef: from.cRef,
    maxMultiplier: Math.min(from.maxMultiplier, to.maxMultiplier),
  });
}

/**
 * Resolve the directional preset (BALANCED → preset) chosen by the
 * sign of the exposure factor. Magnitude of `factor` ∈ [-1, 1]
 * controls the blend strength.
 *
 *   factor < 0 (low exposure)   → blend toward STREAMER
 *   factor > 0 (high exposure)  → blend toward FAST_LOSS
 *   factor == 0                 → pure BALANCED
 */
export function adaptiveParams(
  base: DistributionParams,
  factor: number,
  presets: Record<VolatilityMode, DistributionParams> = MODE_PRESETS,
): { params: DistributionParams; mode: VolatilityMode } {
  if (!Number.isFinite(factor) || factor === 0) {
    return { params: base, mode: 'BALANCED' };
  }
  if (factor > 0) {
    return {
      params: blendDistributions(base, presets.FAST_LOSS, factor),
      mode: 'FAST_LOSS',
    };
  }
  return {
    params: blendDistributions(base, presets.STREAMER, -factor),
    mode: 'STREAMER',
  };
}

// ────────────────────────────────────────────────────────────────────
// Exposure tracker — EMA + clamp on rolling round-level metrics
// ────────────────────────────────────────────────────────────────────

export interface ExposureSnapshot {
  smoothedStake: number;
  smoothedPayout: number;
  smoothedBettors: number;
  rollingRtp: number;
  roundsObserved: number;
}

export interface ExposureTrackerConfig {
  /**
   * EMA decay (alpha): new sample weight per round. 0.1 means each new
   * round contributes 10% to the running average. Higher = more
   * reactive; lower = more stable. Range (0, 1].
   */
  alpha: number;
  /**
   * Round-by-round magnitude of the exposure factor — bigger values
   * make the adaptive blend more aggressive. Range (0, 1].
   *
   * The PDF brief recommends 0.20 as a sane mid-point.
   */
  blendStrength: number;
  /**
   * Reference stake for the normalisation (per-round, in coins). The
   * exposure factor crosses 0 when the smoothed stake equals this
   * value.
   */
  referenceStake: number;
  /** Hard floor / ceiling on the unsmoothed exposure factor. */
  factorMin: number;
  factorMax: number;
}

export const DEFAULT_TRACKER_CFG: ExposureTrackerConfig = {
  alpha: 0.2,
  blendStrength: 0.2,
  referenceStake: 5_000,
  factorMin: -1,
  factorMax: 1,
};

export class ExposureTracker {
  private smoothedStake = 0;
  private smoothedPayout = 0;
  private smoothedBettors = 0;
  private roundsObserved = 0;

  constructor(private readonly cfg: ExposureTrackerConfig = DEFAULT_TRACKER_CFG) {}

  record(round: { stake: number; payout: number; bettors: number }): void {
    const a = this.cfg.alpha;
    this.roundsObserved += 1;
    if (this.roundsObserved === 1) {
      this.smoothedStake = round.stake;
      this.smoothedPayout = round.payout;
      this.smoothedBettors = round.bettors;
      return;
    }
    this.smoothedStake = a * round.stake + (1 - a) * this.smoothedStake;
    this.smoothedPayout = a * round.payout + (1 - a) * this.smoothedPayout;
    this.smoothedBettors = a * round.bettors + (1 - a) * this.smoothedBettors;
  }

  snapshot(): ExposureSnapshot {
    const stake = this.smoothedStake;
    const rollingRtp = stake > 0 ? this.smoothedPayout / stake : 0;
    return {
      smoothedStake: stake,
      smoothedPayout: this.smoothedPayout,
      smoothedBettors: this.smoothedBettors,
      rollingRtp,
      roundsObserved: this.roundsObserved,
    };
  }

  /**
   * Exposure factor `t ∈ [-1, 1]` for the next round. Uses a
   * tanh-squashed log ratio so doubling vs halving the stake produce
   * symmetric opposite factors.
   */
  exposureFactor(): number {
    const stake = this.smoothedStake;
    if (this.roundsObserved < 1 || stake <= 0) return 0;
    const ref = Math.max(1, this.cfg.referenceStake);
    const ratio = stake / ref;
    const raw = Math.log2(ratio) / 2;
    const t = Math.tanh(raw) * this.cfg.blendStrength;
    return Math.max(this.cfg.factorMin, Math.min(this.cfg.factorMax, t));
  }

  /**
   * RTP-drift correction. If the rolling realised RTP is materially
   * above the target, nudge the factor positive (toward FAST_LOSS).
   * Below target → nudge negative (toward STREAMER). The nudge is
   * tiny (max ±0.1) so it doesn't fight the exposure signal.
   */
  rtpDriftFactor(targetRtp: number): number {
    const snap = this.snapshot();
    if (snap.smoothedStake <= 0 || snap.roundsObserved < 50) return 0;
    const drift = snap.rollingRtp - targetRtp;
    const normalised = Math.max(-1, Math.min(1, drift / 0.05));
    return 0.1 * normalised;
  }

  reset(): void {
    this.smoothedStake = 0;
    this.smoothedPayout = 0;
    this.smoothedBettors = 0;
    this.roundsObserved = 0;
  }
}
