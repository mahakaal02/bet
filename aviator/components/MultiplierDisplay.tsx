'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useGame } from '@/lib/store';
import { tierFor } from '@/lib/tiers';
import { formatMultiplier } from '@/lib/format';

/**
 * Hero multiplier overlay. The three states map 1-to-1 to the
 * round lifecycle:
 *
 *   BETTING   →  "STARTING IN 0:03" + tier-cool tag
 *   RUNNING   →  "2.47×" with tier-coloured glow + LIVE tag
 *   CRASHED   →  "FLEW AWAY · 1.42×" with crash-red glow
 *
 * Lives on top of the canvas, so it owns no background of its own —
 * just text + a small tier badge. Framer Motion drives the entrance
 * and exit; the colour ramp is driven directly off the live multiplier
 * via the shared `tierFor()` helper, so every ramp transition (1.5×,
 * 2×, 5×, 10×) hits at the same value across the whole UI.
 */
export default function MultiplierDisplay() {
  const phase = useGame((s) => s.phase);
  const multiplier = useGame((s) => s.multiplier);
  const lastCrash = useGame((s) => s.lastCrash);
  const bettingEndsAt = useGame((s) => s.bettingEndsAt);

  if (phase === 'BETTING') {
    return <BettingState bettingEndsAt={bettingEndsAt} />;
  }
  if (phase === 'CRASHED') {
    const m = lastCrash?.multiplier ?? multiplier ?? 1;
    return <CrashedState multiplier={m} />;
  }
  if (phase === 'RUNNING') {
    return <RunningState multiplier={multiplier} />;
  }
  return <ConnectingState />;
}

function RunningState({ multiplier }: { multiplier: number }) {
  const tier = tierFor(multiplier);

  // Re-trigger the "tick-bump" CSS animation on each new whole-tick
  // value (1.00, 1.01, 1.02, …) so the readout subtly punches with
  // every tick. We key on `tickKey` to force React to remount the
  // span and replay the keyframes.
  const tickKey = Math.floor(multiplier * 100);

  return (
    <div className="pointer-events-none flex flex-col items-center select-none no-caret">
      <motion.div
        key={tier.name}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="mb-1 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em]"
        style={{
          borderColor: `${tier.color}55`,
          backgroundColor: `${tier.color}1A`,
          color: tier.color,
        }}
      >
        <span
          className="inline-block h-1.5 w-1.5 rounded-full glow-breath"
          style={{ backgroundColor: tier.color, boxShadow: `0 0 8px ${tier.color}` }}
        />
        {tier.label}
      </motion.div>
      <div
        className={`font-mono font-black leading-none ${tier.textGlow}`}
        style={{
          color: tier.color,
          fontSize: 'clamp(56px, 12vw, 132px)',
          letterSpacing: '-0.04em',
        }}
      >
        <span key={tickKey} className="inline-block tick-bump">
          {formatMultiplier(multiplier)}
        </span>
      </div>
    </div>
  );
}

function CrashedState({ multiplier }: { multiplier: number }) {
  const tier = tierFor(multiplier);
  return (
    <motion.div
      key="crashed"
      initial={{ scale: 0.92, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 22 }}
      className="pointer-events-none flex flex-col items-center select-none no-caret"
    >
      <div className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-danger/60 bg-danger/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.22em] text-danger">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-danger" />
        Flew away
      </div>
      <div
        className={`font-mono font-black leading-none ${tier.textGlow}`}
        style={{
          color: tier.color,
          fontSize: 'clamp(56px, 12vw, 132px)',
          letterSpacing: '-0.04em',
        }}
      >
        {formatMultiplier(multiplier)}
      </div>
    </motion.div>
  );
}

function BettingState({ bettingEndsAt }: { bettingEndsAt: number | null }) {
  const [remaining, setRemaining] = useState<number>(0);
  useEffect(() => {
    if (!bettingEndsAt) return;
    const update = () =>
      setRemaining(Math.max(0, (bettingEndsAt - Date.now()) / 1000));
    update();
    const id = setInterval(update, 80);
    return () => clearInterval(id);
  }, [bettingEndsAt]);

  // Visual urgency — last 3 seconds tip from violet to ember orange.
  const urgent = remaining <= 3.0;
  const color = urgent ? '#FF8A3D' : '#8B5CFF';
  const glow = urgent ? 'text-glow-hot' : 'text-glow-violet';
  const label = urgent ? 'Almost!' : 'Place your bet';

  return (
    <div className="pointer-events-none flex flex-col items-center select-none no-caret">
      <motion.div
        key={urgent ? 'urgent' : 'calm'}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="mb-1 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.22em]"
        style={{
          borderColor: `${color}55`,
          backgroundColor: `${color}1A`,
          color,
        }}
      >
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${urgent ? 'anticipate' : 'glow-breath'}`}
          style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
        />
        {label}
      </motion.div>
      <div
        className={`font-mono font-black leading-none ${glow}`}
        style={{
          color,
          fontSize: 'clamp(56px, 12vw, 132px)',
          letterSpacing: '-0.04em',
        }}
      >
        {remaining.toFixed(1)}s
      </div>
    </div>
  );
}

function ConnectingState() {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="pointer-events-none flex flex-col items-center select-none no-caret"
      >
        <div className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-divider bg-elevated/60 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.22em] text-text-secondary">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-text-muted animate-pulse" />
          Connecting
        </div>
        <div
          className="font-mono font-black leading-none text-text-secondary"
          style={{ fontSize: 'clamp(48px, 10vw, 96px)', letterSpacing: '-0.04em' }}
        >
          —
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
