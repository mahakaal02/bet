/**
 * Multiplier tier system — single source of truth for emotional
 * colour escalation across the game. The same `tierFor()` mapping
 * is used by the canvas (curve gradient, mascot aura, particles),
 * the MultiplierDisplay (text colour + glow), the HistoryRail
 * (badge chip colour), and the Live Player feed (cashout colour),
 * so a 12.4× win flashes legendary gold *everywhere* at once.
 *
 * The ramp is intentionally narrow at the low end (1.0 → 2.0 covers
 * three tiers) so the player gets continuous feedback during the
 * tense early seconds of the round, and broader at the high end
 * where 5×+ is already an exceptional outcome.
 */

export type TierName = 'cool' | 'warm' | 'hot' | 'fire' | 'legend';

export interface Tier {
  name: TierName;
  /** Display label — surfaced on the multiplier readout as a small
   *  uppercase tag and on the history-rail tooltip. */
  label: string;
  /** Primary tint, used for text + glow + accent borders. */
  color: string;
  /** Slightly deeper companion for gradient ends + shadows. */
  colorDeep: string;
  /** Tailwind helper class for the matching text-glow effect. */
  textGlow: string;
  /** Tailwind helper class for the matching ring-glow effect. */
  ringGlow: string;
}

export const TIERS: Record<TierName, Tier> = {
  cool: {
    name: 'cool',
    label: 'STEADY',
    color: '#22E0BD',
    colorDeep: '#15B894',
    textGlow: 'text-glow-cool',
    ringGlow: 'ring-glow-cool',
  },
  warm: {
    name: 'warm',
    label: 'CLIMB',
    color: '#3DD9FF',
    colorDeep: '#1FA8D4',
    textGlow: 'text-glow-warm',
    ringGlow: 'ring-glow-warm',
  },
  hot: {
    name: 'hot',
    label: 'HOT',
    color: '#FF8A3D',
    colorDeep: '#E5651A',
    textGlow: 'text-glow-hot',
    ringGlow: 'ring-glow-hot',
  },
  fire: {
    name: 'fire',
    label: 'DANGER',
    color: '#FF4D6D',
    colorDeep: '#D62A4D',
    textGlow: 'text-glow-fire',
    ringGlow: 'ring-glow-fire',
  },
  legend: {
    name: 'legend',
    label: 'LEGEND',
    color: '#FFC857',
    colorDeep: '#E5A82E',
    textGlow: 'text-glow-legend',
    ringGlow: 'ring-glow-legend',
  },
};

export function tierFor(multiplier: number): Tier {
  if (multiplier >= 10) return TIERS.legend;
  if (multiplier >= 5)  return TIERS.fire;
  if (multiplier >= 2)  return TIERS.hot;
  if (multiplier >= 1.5) return TIERS.warm;
  return TIERS.cool;
}

/**
 * Smooth 0→1 intensity within the current tier. Used by the canvas
 * to interpolate the mascot aura size + particle density so the
 * acceleration feels continuous even when the tier label snaps.
 */
export function tierProgress(multiplier: number): number {
  if (multiplier >= 10) return Math.min(1, (multiplier - 10) / 40);
  if (multiplier >= 5)  return (multiplier - 5) / 5;
  if (multiplier >= 2)  return (multiplier - 2) / 3;
  if (multiplier >= 1.5) return (multiplier - 1.5) / 0.5;
  return (multiplier - 1) / 0.5;
}
