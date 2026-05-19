'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useMemo } from 'react';
import { useGame } from '@/lib/store';
import { tierFor } from '@/lib/tiers';
import { formatRupees } from '@/lib/format';
import type { RosterEntry } from '@/lib/types';

/**
 * Live player feed — the social side of the table. Two visual states:
 *
 *   active  →  username glows in their assigned brand colour, with a
 *              small pulsing dot indicating the bet is still in the
 *              air. Stake on the right, auto-cashout target if set.
 *
 *   cashed  →  row shifts to a muted background, the right side
 *              switches to the captured multiplier in its tier colour,
 *              and the row briefly flashes (controlled by Framer's
 *              `layout` re-order plus the gradient backplate).
 *
 * Stats header surfaces total bet count + pooled rupee volume so the
 * player feels the size of the table at a glance.
 */

const USERNAME_PALETTE = [
  '#8B5CFF', '#3DD9FF', '#22E0BD', '#FFC857',
  '#FF8A3D', '#FF4D9A', '#5DADE2', '#A78BFA',
];

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return USERNAME_PALETTE[h % USERNAME_PALETTE.length];
}

export default function RosterPanel() {
  const roster = useGame((s) => s.roster);
  const phase = useGame((s) => s.phase);

  const { active, cashedOut, totalStake, totalCashed } = useMemo(() => {
    let totalStake = 0;
    let totalCashed = 0;
    const active: RosterEntry[] = [];
    const cashedOut: RosterEntry[] = [];
    for (const b of roster) {
      totalStake += b.amount;
      if (b.cashedOutAt === null) active.push(b);
      else {
        cashedOut.push(b);
        totalCashed += Math.floor(b.amount * b.cashedOutAt);
      }
    }
    return { active, cashedOut, totalStake, totalCashed };
  }, [roster]);

  return (
    <aside
      className="glass rounded-3xl flex flex-col overflow-hidden"
      style={{ minHeight: 380 }}
    >
      <header className="px-4 pt-4 pb-3 border-b border-divider">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-[0.20em] text-text-secondary">
            Players
          </h2>
          <span className="font-mono text-xs text-text-secondary">
            {roster.length}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
          <Stat
            label="Bet volume"
            value={formatRupees(totalStake)}
            tone="primary"
          />
          <Stat
            label="Paid out"
            value={formatRupees(totalCashed)}
            tone="success"
          />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto scroll-cool px-2 py-2 space-y-1">
        {roster.length === 0 ? (
          <p className="text-text-muted text-xs px-2 py-3">
            {phase === 'BETTING'
              ? 'No bets yet for this round.'
              : 'Waiting for next round…'}
          </p>
        ) : (
          <>
            <AnimatePresence initial={false}>
              {active.map((b) => (
                <PlayerRow key={`a-${b.username}`} bet={b} state="active" />
              ))}
            </AnimatePresence>
            {cashedOut.length > 0 && (
              <div className="pt-2 mt-2 border-t border-divider/60 space-y-1">
                <p className="text-[10px] uppercase tracking-[0.18em] text-text-muted px-2 pt-1">
                  Cashed out · {cashedOut.length}
                </p>
                <AnimatePresence initial={false}>
                  {cashedOut.map((b) => (
                    <PlayerRow key={`c-${b.username}`} bet={b} state="cashed" />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'primary' | 'success';
}) {
  const color = tone === 'success' ? '#22E0BD' : '#8B5CFF';
  return (
    <div
      className="rounded-lg px-2 py-1.5 border"
      style={{
        borderColor: `${color}30`,
        backgroundColor: `${color}0F`,
      }}
    >
      <div className="text-[9px] uppercase tracking-[0.15em] text-text-secondary">
        {label}
      </div>
      <div
        className="font-mono text-xs font-bold tabular-nums"
        style={{ color }}
      >
        {value}
      </div>
    </div>
  );
}

function PlayerRow({
  bet,
  state,
}: {
  bet: RosterEntry;
  state: 'active' | 'cashed';
}) {
  const color = colorFor(bet.username);
  const tier = bet.cashedOutAt != null ? tierFor(bet.cashedOutAt) : null;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{
        opacity: state === 'active' ? 1 : 0.85,
        y: 0,
        scale: 1,
        backgroundColor:
          state === 'cashed' ? `${tier?.color ?? color}1A` : 'rgba(27,35,71,0.4)',
      }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ type: 'spring', stiffness: 340, damping: 26 }}
      className="flex items-center justify-between gap-3 px-2 py-1.5 rounded-lg border"
      style={{
        borderColor:
          state === 'cashed' ? `${tier?.color ?? color}30` : 'transparent',
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Avatar name={bet.username} color={color} active={state === 'active'} />
        <span
          className="truncate text-xs font-semibold"
          style={{ color: state === 'cashed' ? '#B6C0DD' : color }}
        >
          {bet.username}
        </span>
      </div>
      <div className="flex items-center gap-2 font-mono whitespace-nowrap text-xs">
        <span className="text-text-secondary tabular-nums">
          {formatRupees(bet.amount)}
        </span>
        {state === 'cashed' && tier ? (
          <span
            className="font-bold tabular-nums"
            style={{ color: tier.color }}
          >
            {bet.cashedOutAt!.toFixed(2)}×
          </span>
        ) : bet.autoCashoutAt != null ? (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-md border border-success/40 text-success/90 bg-success/10 tabular-nums"
            title="Auto-cashout target"
          >
            auto {bet.autoCashoutAt.toFixed(2)}×
          </span>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </div>
    </motion.div>
  );
}

function Avatar({
  name,
  color,
  active,
}: {
  name: string;
  color: string;
  active: boolean;
}) {
  const initial = name.slice(0, 1).toUpperCase();
  return (
    <span
      className="relative inline-flex h-6 w-6 items-center justify-center rounded-full font-bold text-[10px] flex-shrink-0"
      style={{
        backgroundColor: `${color}22`,
        color,
        boxShadow: `inset 0 0 0 1px ${color}55`,
      }}
    >
      {initial}
      {active && (
        <span
          className="absolute -bottom-0.5 -right-0.5 inline-block h-2 w-2 rounded-full glow-breath"
          style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
        />
      )}
    </span>
  );
}
