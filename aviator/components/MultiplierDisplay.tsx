'use client';

import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useGame } from '@/lib/store';

/**
 * Top-of-stage status pill. The big numerical multiplier is now
 * drawn on the canvas alongside the mascot (`GameStage.tsx`), so
 * this overlay carries only the round-state metadata the player
 * needs to read at a glance:
 *
 *   BETTING   →  "Starts in 0.8s"  (violet, ember in the final 3s)
 *   RUNNING   →  small "In flight" pill (tier-coloured dot pulse)
 *   CRASHED   →  brief "Flew away" pill that fades out automatically
 *
 * Designed to sit unobtrusively at top-centre so it never competes
 * for attention with the mascot + curve. Earlier versions had a
 * giant centred multiplier readout that fought with the canvas for
 * focus and pushed the curve out of view on phones — replaced by
 * this medium-weight pill.
 */
export default function MultiplierDisplay() {
  const phase = useGame((s) => s.phase);
  const bettingEndsAt = useGame((s) => s.bettingEndsAt);

  if (phase === 'BETTING') return <BettingPill bettingEndsAt={bettingEndsAt} />;
  if (phase === 'CRASHED') return <CrashedPill />;
  if (phase === 'RUNNING') return <RunningPill />;
  return <ConnectingPill />;
}

function BettingPill({ bettingEndsAt }: { bettingEndsAt: number | null }) {
  const [remaining, setRemaining] = useState<number>(0);
  useEffect(() => {
    if (!bettingEndsAt) return;
    const update = () =>
      setRemaining(Math.max(0, (bettingEndsAt - Date.now()) / 1000));
    update();
    const id = setInterval(update, 80);
    return () => clearInterval(id);
  }, [bettingEndsAt]);

  // Visual urgency — last 3 seconds shift the pill from cool violet
  // to ember orange so the eye is drawn to the countdown.
  const urgent = remaining <= 3.0;
  const color = urgent ? '#FF8A3D' : '#8B5CFF';
  const label = urgent ? 'Almost!' : 'Starts in';

  return (
    <motion.div
      key={urgent ? 'urgent' : 'calm'}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 backdrop-blur"
      style={{
        borderColor: `${color}55`,
        backgroundColor: `${color}1F`,
        color,
      }}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${urgent ? 'anticipate' : 'glow-breath'}`}
        style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
      />
      <span className="text-[10px] font-bold uppercase tracking-[0.22em]">
        {label}
      </span>
      <span className="font-mono text-sm font-black tabular-nums leading-none">
        {remaining.toFixed(1)}s
      </span>
    </motion.div>
  );
}

function RunningPill() {
  return (
    <motion.div
      key="running"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="inline-flex items-center gap-2 rounded-full border border-success/45 bg-success/15 px-3 py-1 backdrop-blur text-success"
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full bg-success glow-breath"
        style={{ boxShadow: '0 0 8px #22E0BD' }}
      />
      <span className="text-[10px] font-bold uppercase tracking-[0.22em]">
        In flight
      </span>
    </motion.div>
  );
}

function CrashedPill() {
  return (
    <motion.div
      key="crashed"
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 22 }}
      className="inline-flex items-center gap-2 rounded-full border border-danger/55 bg-danger/15 px-3 py-1 backdrop-blur text-danger"
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-danger" />
      <span className="text-[10px] font-bold uppercase tracking-[0.22em]">
        Flew away
      </span>
    </motion.div>
  );
}

function ConnectingPill() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="inline-flex items-center gap-2 rounded-full border border-divider bg-elevated/60 px-3 py-1 backdrop-blur text-text-secondary"
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-text-muted animate-pulse" />
      <span className="text-[10px] font-bold uppercase tracking-[0.22em]">
        Connecting
      </span>
    </motion.div>
  );
}
