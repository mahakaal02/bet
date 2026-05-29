'use client';

import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useGame } from '@/lib/store';
import { useTranslation } from '@/lib/i18n/client';

/**
 * Top-of-stage status pill. The big numerical multiplier is now
 * drawn on the canvas alongside the mascot (`GameStage.tsx`), so
 * this overlay carries only the round-state metadata the player
 * needs to read at a glance:
 *
 *   BETTING   →  "Starts in 8s"   (violet, ember in the final 3s)
 *   RUNNING   →  small "In flight" pill (tier-coloured dot pulse)
 *   CRASHED   →  brief "Crashed" pill that fades out automatically
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
  const { t } = useTranslation();
  // Whole-second integer countdown. Previously this displayed one
  // decimal (e.g. `8.3s`) which read as "milliseconds in the readout"
  // and made the urgency feel jittery rather than crisp. A 1 Hz tick
  // is enough — the BETTING window is 10 s, the player only needs
  // second-level precision.
  const [remainingSec, setRemainingSec] = useState<number>(0);
  useEffect(() => {
    if (!bettingEndsAt) return;
    let timer: ReturnType<typeof setTimeout>;
    // Self-correcting countdown: recompute from the wall clock each tick
    // (so drift never accumulates) and schedule the NEXT wake-up at the
    // next whole-second boundary rather than polling at a fixed 5 Hz. The
    // displayed value only changes once per second (`Math.ceil`), so this
    // fires once per visible change instead of five times — same crispness,
    // a fifth of the timer wake-ups.
    const tick = () => {
      const msLeft = bettingEndsAt - Date.now();
      setRemainingSec(Math.max(0, Math.ceil(msLeft / 1000)));
      if (msLeft <= 0) return; // done — stop scheduling
      // Fractional remainder to the next boundary (+ a small fudge so
      // `ceil` has definitely ticked down by the time we re-read).
      const msToBoundary = msLeft % 1000 || 1000;
      timer = setTimeout(tick, msToBoundary + 20);
    };
    tick();
    return () => clearTimeout(timer);
  }, [bettingEndsAt]);

  // Visual urgency — last 3 seconds shift the pill from cool violet
  // to ember orange so the eye is drawn to the countdown.
  const urgent = remainingSec <= 3;
  const color = urgent ? '#FF8A3D' : '#8B5CFF';
  const label = urgent ? t('game.almost') : t('game.startsIn');

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
        {remainingSec}s
      </span>
    </motion.div>
  );
}

function RunningPill() {
  const { t } = useTranslation();
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
        {t('game.inFlight')}
      </span>
    </motion.div>
  );
}

function CrashedPill() {
  const { t } = useTranslation();
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
        {t('game.crashed')}
      </span>
    </motion.div>
  );
}

function ConnectingPill() {
  const { t } = useTranslation();
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="inline-flex items-center gap-2 rounded-full border border-divider bg-elevated/60 px-3 py-1 backdrop-blur text-text-secondary"
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-text-muted animate-pulse" />
      <span className="text-[10px] font-bold uppercase tracking-[0.22em]">
        {t('game.connecting')}
      </span>
    </motion.div>
  );
}
