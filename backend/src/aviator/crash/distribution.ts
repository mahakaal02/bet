/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * Crash-multiplier distribution engine.
 * =====================================
 *
 * Pure math. No I/O, no Date.now, no Prisma, no Logger. Everything in
 * here is deterministic given (uniform u ∈ [0,1), DistributionParams).
 *
 * --------------------------------------------------------------------
 * 1. The canonical crash model
 * --------------------------------------------------------------------
 *
 * Real crash games (Bustabit, Stake, Aviator) use a Pareto survival
 * function:
 *
 *     P(M >= x) = RTP / x          for x >= 1, RTP in (0, 1]
 *
 * For any player cashout strategy C >= 1, the expected return per unit
 * stake is
 *
 *     E[payout|C] = C * P(M >= C) = C * (RTP / C) = RTP.
 *
 * So RTP is STRATEGY-INVARIANT — the house always edges (1 - RTP) per
 * round regardless of whether the player auto-cashes at 1.5x, 2x or
 * 10x. That's the operator's invariant.
 *
 * Inversion: given a uniform U ∈ [0, 1), sampling M = 1 / (1 - U)
 * produces the fair (RTP=1) distribution. To inject a house edge we
 * insert a "split mass" at 1.00:
 *
 *     P(M = 1.00) = 1 - RTP
 *     P(M >  x  ) = RTP / x    for x >= 1
 *
 * Identical to the existing `fairness.ts` implementation, just
 * generalised so the operator can dial RTP from 0.94 to 0.99 instead
 * of being pinned to 32/33.
 *
 * --------------------------------------------------------------------
 * 2. Heavy "feel" — bias mass below the bias upper edge
 * --------------------------------------------------------------------
 *
 * Player-psychology research (Crash Game Probability Model.pdf +
 * Executive Summary.docx attached to this task) recommends a heavier
 * concentration of early crashes than a pure 1/x curve provides: ~35%
 * of rounds under 1.20x vs ~17% in a pure RTP=0.96 curve.
 *
 * We achieve this with a `bias` knob — a probability mass moved out of
 * the 1/x tail and uniformly redistributed over [1, biasUpper). Higher
 * bias = more early crashes = more "addictive" / near-miss feel.
 *
 *     P(M = 1.00)                       = (1 - RTP) * (1 - bias)
 *     P(1.00 < M < biasUpper)            = bias + (1 - bias) * smallMass
 *     P(M >= x)                          = (1 - bias) * RTP / x   for x >= biasUpper
 *
 * where smallMass is the pure-1/x mass in [1, biasUpper) the bias is
 * MIXED with, NOT replaced — keeps the curve smooth (no discontinuity
 * at biasUpper). See the sampler for the exact mixture.
 *
 * --------------------------------------------------------------------
 * 3. Tail extension parameter `k`
 * --------------------------------------------------------------------
 *
 * For the FAST_LOSS / STREAMER blends we let the operator over- or
 * under-weight the long tail. Standard crash uses k=1 (1/x); FAST_LOSS
 * wants k slightly > 1 (thinner tail, fewer 10x+ moments); STREAMER
 * wants k slightly < 1 (fatter tail, more screenshot moments).
 *
 * The trick: when k differs from 1, the operator-friendly invariant
 * weakens — RTP becomes strategy-dependent. To preserve the published
 * RTP at the canonical cashout C_ref (default 2.0), the engine scales
 * the tail amplitude so that
 *
 *     C_ref * P(M >= C_ref) = RTP
 *
 * still holds exactly. Players who cash at OTHER C see slight drift —
 * which is realistic (real crash sites give jackpot-hunters a worse
 * effective edge). The `solveTailExponent` helper isn't needed in this
 * model; `k` is a direct knob.
 *
 * --------------------------------------------------------------------
 * 4. Sampling (inverse CDF)
 * --------------------------------------------------------------------
 *
 * Given u uniform in [0, 1):
 *
 *   1. Insta-crash mass q = (1 - RTP) * (1 - bias).
 *      if u < q → M = 1.00
 *
 *   2. Bias-mass band over [1, biasUpper).
 *      mass = bias (does NOT depend on RTP — we mix it back in below)
 *      if u < q + mass → M = 1 + ((u - q) / mass) * (biasUpper - 1)
 *
 *   3. Heavy tail.
 *      v = (u - q - mass) / (1 - q - mass)  ∈ [0, 1)
 *      M = (alpha / (1 - v))^(1/k)
 *      Clipped at `maxMultiplier`.
 *
 *      `alpha` is the tail amplitude chosen so that the publicly
 *      advertised RTP holds at the canonical cashout C_ref.
 */

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────

export interface DistributionParams {
  /** Target RTP at the canonical cashout (C_ref). 0.96 → 4% edge. */
  rtp: number;
  /** Extra probability mass distributed uniformly over [1, biasUpper). */
  bias: number;
  /** Upper edge of the bias band. Typically 1.5. */
  biasUpper: number;
  /** Tail exponent. k=1 → 1/x (canonical). k>1 → thinner. k<1 → fatter. */
  k: number;
  /** Canonical reference cashout used to lock RTP. */
  cRef: number;
  /** Hard ceiling on any sampled multiplier. */
  maxMultiplier: number;
}

export const PARAM_BOUNDS = {
  rtp: { min: 0.5, max: 0.999 },
  bias: { min: 0, max: 0.5 },
  biasUpper: { min: 1.01, max: 5 },
  k: { min: 0.7, max: 2.0 },
  cRef: { min: 1.05, max: 10 },
  maxMultiplier: { min: 10, max: 1_000_000 },
} as const;

/**
 * Baseline: pure canonical 1/x crash with the brief's recommended 4%
 * house edge and a moderate bias band to push the histogram closer to
 * the "35% under 1.20x" feel target.
 */
export const DEFAULT_PARAMS: DistributionParams = {
  rtp: 0.96,
  bias: 0.18,
  biasUpper: 1.5,
  k: 1.0,
  cRef: 2.0,
  maxMultiplier: 10_000,
};

// ────────────────────────────────────────────────────────────────────
// Tail amplitude — locks RTP at C_ref under any k
// ────────────────────────────────────────────────────────────────────

/**
 * Tail survival function P(M >= x | landed in the tail-uniform
 * region). Given:
 *
 *     M = (alpha / (1 - V))^(1/k),   V ~ Uniform[0, 1)
 *
 * we have P(M >= x | V) → V <= 1 - alpha / x^k.
 *
 * Hence (unconditioned by V at all):
 *
 *     P(M >= x | tail) = 1 - F_V(1 - alpha / x^k) = alpha / x^k
 *
 * for x^k >= alpha. (When alpha / x^k > 1 the formula caps at 1.)
 *
 * Joining with the head + bias mass (only the "tail-uniform" branch is
 * eligible for high outcomes when biasUpper <= C_ref), the
 * unconditioned survival at x = C_ref is
 *
 *     P(M >= C_ref) = (1 - q - bias) * alpha / C_ref^k,
 *
 * where q = (1 - RTP) * (1 - bias). Setting that times C_ref equal to
 * RTP gives the closed-form alpha below.
 */
function tailAlpha(params: DistributionParams): number {
  const p = clampParams(params);
  const q = (1 - p.rtp) * (1 - p.bias);
  const tailMass = Math.max(1e-9, 1 - q - p.bias);
  // RTP target at C_ref: C_ref * tailMass * alpha / C_ref^k = RTP
  // → alpha = RTP * C_ref^(k-1) / tailMass
  return (p.rtp * Math.pow(p.cRef, p.k - 1)) / tailMass;
}

// ────────────────────────────────────────────────────────────────────
// Sampling — inverse CDF
// ────────────────────────────────────────────────────────────────────

/**
 * Inverse-CDF sample from the (insta + bias-band + heavy-tail)
 * mixture. `u` is a uniform draw in [0, 1). Deterministic; the same
 * (u, params) returns the same multiplier byte-for-byte.
 *
 * Returns a value >= 1.00, rounded DOWN to 2 decimal places (matches
 * the `Decimal(10,2)` column type on `AviatorRound`).
 */
export function sampleMultiplier(u: number, params: DistributionParams): number {
  const p = clampParams(params);
  const uClamped = clamp01(u);

  const q = (1 - p.rtp) * (1 - p.bias);
  const biasBoundary = q + p.bias;

  // Region 1 — insta-crash mass.
  if (uClamped < q) return 1.0;

  // Region 2 — bias band over [1, biasUpper).
  if (uClamped < biasBoundary) {
    const v = (uClamped - q) / p.bias;
    const m = 1 + v * (p.biasUpper - 1);
    return floor2(Math.max(1.0, Math.min(m, p.maxMultiplier)));
  }

  // Region 3 — heavy tail with amplitude locked to RTP.
  const tailMass = 1 - biasBoundary;
  if (tailMass <= 0) {
    return floor2(Math.min(p.biasUpper, p.maxMultiplier));
  }
  let v = (uClamped - biasBoundary) / tailMass;
  // Bias v away from 1.0 by 2^-32 so the inversion can never produce Infinity.
  v = Math.min(v, 1 - 1 / 0x1_0000_0000);

  const alpha = tailAlpha(p);
  // M = (alpha / (1 - v))^(1/k). For k=1 this is the canonical 1/x.
  const raw = Math.pow(alpha / (1 - v), 1 / p.k);
  const m = Math.min(raw, p.maxMultiplier);
  return floor2(Math.max(1.0, m));
}

// ────────────────────────────────────────────────────────────────────
// Analytics — survival, buckets, "operator RTP at C_ref"
// ────────────────────────────────────────────────────────────────────

/**
 * Analytic survival P(M >= x). Three regions: bias-band is uniform on
 * [1, biasUpper); tail uses the Pareto amplitude `alpha`.
 */
export function survival(x: number, params: DistributionParams): number {
  const p = clampParams(params);
  if (x <= 1.0) return 1.0;
  if (x >= p.maxMultiplier) return 0.0;

  const q = (1 - p.rtp) * (1 - p.bias);
  const alpha = tailAlpha(p);
  const tailMass = Math.max(0, 1 - q - p.bias);

  // Tail-only branch survival at x: alpha / x^k (capped at 1).
  const tailSurv = Math.min(1, alpha / Math.pow(x, p.k));

  if (x >= p.biasUpper) {
    return tailMass * tailSurv;
  }

  // Inside the bias band.
  const biasFracAbove = (p.biasUpper - x) / (p.biasUpper - 1);
  return Math.max(0, p.bias * biasFracAbove + tailMass * tailSurv);
}

export const BUCKET_EDGES = [1.2, 1.5, 2.0, 3.0, 5.0, 10.0] as const;

export interface BucketProbability {
  label: string;
  loInclusive: number;
  hiExclusive: number;
  probability: number;
}

export function bucketProbabilities(params: DistributionParams): BucketProbability[] {
  const edges = [1.0, ...BUCKET_EDGES, Infinity];
  const out: BucketProbability[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const probability = Math.max(0, survival(lo, params) - survival(hi, params));
    out.push({
      label: labelForRange(lo, hi),
      loInclusive: lo,
      hiExclusive: hi,
      probability,
    });
  }
  return out;
}

function labelForRange(lo: number, hi: number): string {
  if (lo === 1.0 && hi === 1.2) return '<1.20';
  if (hi === Infinity) return `>=${lo.toFixed(2)}`;
  return `${lo.toFixed(2)}–${hi.toFixed(2)}`;
}

/**
 * Operator-facing RTP, evaluated at C_ref. For k=1 this is exactly
 * `params.rtp`; for other k there's a small drift that the simulator
 * surfaces. Returns the analytic value the engine targets — the
 * Monte-Carlo realised RTP converges to this in long runs.
 */
export interface RtpBreakdown {
  /** Configured RTP target. */
  configured: number;
  /** Analytic RTP at the canonical cashout C_ref. */
  atRef: number;
  /** Analytic RTP if the player auto-cashes at exactly 1.20x. */
  atLow: number;
  /** Analytic RTP if the player auto-cashes at exactly 10.00x. */
  atHigh: number;
  /** P(M = 1) — the insta-crash mass. */
  pInsta: number;
}

export function rtpBreakdown(params: DistributionParams): RtpBreakdown {
  const p = clampParams(params);
  const q = (1 - p.rtp) * (1 - p.bias);
  return {
    configured: p.rtp,
    atRef: p.cRef * survival(p.cRef, p),
    atLow: 1.2 * survival(1.2, p),
    atHigh: 10.0 * survival(10.0, p),
    pInsta: q,
  };
}

/**
 * Closed-form expected multiplier E[M] = ∫_1^∞ x f(x) dx.
 *
 * For the operator this is informational only — the strategy-invariant
 * RTP at C_ref is the real economic quantity. But the test suite uses
 * E[M] as a Monte-Carlo convergence target.
 */
export function expectedValue(params: DistributionParams): number {
  const p = clampParams(params);
  const q = (1 - p.rtp) * (1 - p.bias);
  const tailMass = Math.max(0, 1 - q - p.bias);

  // Bias band mean: (1 + biasUpper) / 2.
  const biasMean = (1 + p.biasUpper) / 2;

  // Tail mean (truncated at biasUpper from below, maxMultiplier from above)
  // with survival = alpha / x^k.
  // E[M_tail] = ∫_{biasUpper}^{maxMult} x * f_tail(x) dx
  //           = ∫_{biasUpper}^{maxMult} -x * d/dx survival(x|tail) dx
  // For survival(x) = alpha/x^k truncated, this is
  //   ∫ x * k*alpha*x^(-k-1) dx = k*alpha * [x^(1-k)/(1-k)]
  // (for k != 1). For k=1: ∫ alpha/x dx = alpha * ln(x).
  const alpha = tailAlpha(p);
  const x0 = p.biasUpper;
  const x1 = p.maxMultiplier;
  let tailMean: number;
  if (Math.abs(p.k - 1) < 1e-6) {
    // k=1 case: E[M_tail | tail] = alpha * (ln(x1) - ln(x0)) / survivalProb
    // where survivalProb = alpha/x0 - alpha/x1.
    const num = alpha * (Math.log(x1) - Math.log(x0));
    const den = alpha / x0 - alpha / x1;
    tailMean = num / Math.max(den, 1e-12);
  } else {
    const num = (p.k * alpha) / (1 - p.k) *
      (Math.pow(x1, 1 - p.k) - Math.pow(x0, 1 - p.k));
    const den = alpha * (Math.pow(x0, -p.k) - Math.pow(x1, -p.k));
    tailMean = num / Math.max(den, 1e-12);
  }

  return q * 1.0 + p.bias * biasMean + tailMass * tailMean;
}

// ────────────────────────────────────────────────────────────────────
// Deterministic uniform from an HMAC hex digest
// ────────────────────────────────────────────────────────────────────

export function uniformFromHmacHex(hex: string, offset = 0): number {
  const max = hex.length;
  let chunk = '';
  for (let i = 0; i < 13; i++) {
    chunk += hex[(offset + i) % max];
  }
  const e = parseInt(chunk, 16);
  return e / 0x10000000000000;
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x >= 1) return 1 - Number.EPSILON;
  return x;
}

function floor2(x: number): number {
  return Math.floor(x * 100) / 100;
}

/**
 * Clamp every knob into its declared safe band. The engine never
 * trusts caller input — a misconfigured `SystemSetting` row should
 * degrade gracefully, not crash the game loop.
 */
export function clampParams(params: DistributionParams): DistributionParams {
  const c = <T extends keyof typeof PARAM_BOUNDS>(
    key: T,
    value: number,
  ): number => {
    const b = PARAM_BOUNDS[key];
    if (!Number.isFinite(value)) return DEFAULT_PARAMS[key];
    return Math.min(b.max, Math.max(b.min, value));
  };
  const rtp = c('rtp', params.rtp);
  let bias = c('bias', params.bias);
  // Hard invariant: insta-crash mass + bias mass < 1 with some tail
  // headroom. q = (1-rtp)*(1-bias); we need q + bias <= 0.95.
  const maxBias = (1 - (1 - rtp) - 0.05) / Math.max(rtp, 1e-6);
  if (bias > maxBias) bias = Math.max(0, Math.min(maxBias, bias));
  const biasUpper = Math.max(1.01, c('biasUpper', params.biasUpper));
  const k = c('k', params.k);
  const cRef = c('cRef', params.cRef);
  const maxMultiplier = c('maxMultiplier', params.maxMultiplier);
  return { rtp, bias, biasUpper, k, cRef, maxMultiplier };
}

/**
 * Compatibility shim. Old call sites used to ask for a "tail
 * exponent given target RTP" — in the new model RTP is locked
 * structurally so this just returns the input `k` (or the default).
 * Kept exported so the simulator script keeps compiling unchanged.
 */
export function solveTailExponent(
  partial: Partial<DistributionParams> & { k?: number },
  _targetRtp: number,
): number {
  return partial.k ?? DEFAULT_PARAMS.k;
}
