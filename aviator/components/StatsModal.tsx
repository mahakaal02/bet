'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '@/lib/api';
import { formatCoins, formatMultiplier } from '@/lib/format';

/**
 * "My stats" modal — player-facing performance summary. Mirrors the
 * stats panel in other Aviator-family games:
 *
 *   ┌─────────────────────────────────┐
 *   │  My Stats                  [X]  │
 *   │  [Day] [Week] [Month] [All]     │
 *   │  ┌────────────┬────────────┐    │
 *   │  │ Biggest X  │ Biggest    │    │
 *   │  │ 25.40×     │ 12,500 c   │    │
 *   │  ├────────────┼────────────┤    │
 *   │  │ Bets       │ Win rate   │    │
 *   │  │ 42         │ 68%        │    │
 *   │  ├────────────┼────────────┤    │
 *   │  │ Wagered    │ Net P/L    │    │
 *   │  │ 50,000     │ +8,200     │    │
 *   │  └────────────┴────────────┘    │
 *   └─────────────────────────────────┘
 *
 * Stats refetch every time the range tab changes. Escape key dismisses
 * the modal (same pattern as HistoryStrip's overlay).
 */

type Range = 'day' | 'week' | 'month' | 'all';

interface StatsResp {
  range: Range;
  since: string | null;
  totalBets: number;
  wins: number;
  losses: number;
  winRate: number;
  totalStaked: number;
  totalPayout: number;
  netProfit: number;
  biggestMultiplier: number;
  biggestWin: number;
}

const RANGES: { key: Range; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'all', label: 'All' },
];

export default function StatsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [range, setRange] = useState<Range>('day');
  const [data, setData] = useState<StatsResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch on open + every time the range tab changes. We don't cache
  // between opens because the stats are likely to have changed (the
  // player just played another round); 1 cheap GET per modal open is
  // a fair trade for always-fresh numbers.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<StatsResp>(`/aviator/stats?range=${range}`)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? 'Could not load stats');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, range]);

  // Escape key dismisses. Listener only mounts while open so we're
  // not adding a global handler on every render.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="stats-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm px-3 pt-3 sm:px-6 sm:pt-12"
          onClick={onClose}
          role="dialog"
          aria-label="My stats"
          aria-modal="true"
        >
          <motion.div
            key="stats-panel"
            initial={{ y: -16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -16, opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 280 }}
            onClick={(e) => e.stopPropagation()}
            className="mx-auto max-w-md glass-strong rounded-3xl p-4 sm:p-5 shadow-card"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-[0.18em] uppercase text-text-primary">
                My Stats
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close stats"
                className="grid h-8 w-8 place-items-center rounded-full border border-divider bg-elevated/60 text-text-secondary hover:text-text-primary hover:bg-elevated chip-press transition"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="6" y1="18" x2="18" y2="6" />
                </svg>
              </button>
            </div>

            {/* Range tabs. Pill row, active tab picks up the success
                accent so the current selection reads at a glance. */}
            <div className="mb-4 inline-flex w-full p-1 rounded-full bg-elevated/70 border border-border">
              {RANGES.map((r) => {
                const active = range === r.key;
                return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setRange(r.key)}
                    aria-pressed={active}
                    className={`flex-1 h-8 rounded-full text-[11px] font-bold uppercase tracking-[0.16em] transition ${
                      active
                        ? 'bg-success/15 text-success border border-success/40'
                        : 'text-text-muted hover:text-text-secondary'
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>

            {/* Stat grid. 2-column layout, six cards (3 rows). The
                two "headline" cards on top get tier-tinted treatment
                because they're the ones players care about most. */}
            {error ? (
              <p className="py-6 text-center text-sm text-danger">{error}</p>
            ) : loading && !data ? (
              <p className="py-6 text-center text-sm text-text-muted">
                Loading stats…
              </p>
            ) : data ? (
              <div className="grid grid-cols-2 gap-2">
                <StatCard
                  label="Biggest X"
                  value={
                    data.biggestMultiplier > 0
                      ? formatMultiplier(data.biggestMultiplier)
                      : '—'
                  }
                  accent="gold"
                />
                <StatCard
                  label="Biggest Win"
                  value={
                    data.biggestWin > 0
                      ? `+${formatCoins(data.biggestWin, { compact: true })}`
                      : '—'
                  }
                  accent="success"
                />
                <StatCard
                  label="Total Bets"
                  value={data.totalBets.toLocaleString('en-IN')}
                />
                <StatCard
                  label="Win Rate"
                  value={
                    data.totalBets > 0
                      ? `${Math.round(data.winRate * 100)}%`
                      : '—'
                  }
                  subValue={
                    data.totalBets > 0
                      ? `${data.wins} won · ${data.losses} lost`
                      : undefined
                  }
                />
                <StatCard
                  label="Wagered"
                  value={formatCoins(data.totalStaked, { compact: true })}
                />
                <StatCard
                  label="Net P/L"
                  value={
                    (data.netProfit >= 0 ? '+' : '−') +
                    formatCoins(Math.abs(data.netProfit), { compact: true })
                  }
                  accent={
                    data.netProfit > 0
                      ? 'success'
                      : data.netProfit < 0
                        ? 'danger'
                        : undefined
                  }
                />
              </div>
            ) : null}

            {/* Footnote — explains the time anchor so the player
                doesn't wonder why their "Day" total is lower than
                what they remember playing this morning. */}
            <p className="mt-3 text-[10px] text-text-muted text-center leading-tight">
              {range === 'day' && 'Last 24 hours · sampled from your 200 most recent bets'}
              {range === 'week' && 'Last 7 days · sampled from your 200 most recent bets'}
              {range === 'month' && 'Last 30 days · sampled from your 200 most recent bets'}
              {range === 'all' && 'Since account creation · sampled from your 200 most recent bets'}
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * One stat tile. Defaults to a neutral tone; the `accent` prop applies
 * a tier-tint border + text colour for the headline stats.
 */
function StatCard({
  label,
  value,
  subValue,
  accent,
}: {
  label: string;
  value: string;
  subValue?: string;
  accent?: 'success' | 'danger' | 'gold';
}) {
  const accentClass =
    accent === 'success'
      ? 'border-success/40 bg-success/10 text-success'
      : accent === 'danger'
        ? 'border-danger/40 bg-danger/10 text-danger'
        : accent === 'gold'
          ? 'border-gold/40 bg-gold/10 text-gold'
          : 'border-border bg-elevated/60 text-text-primary';
  return (
    <div className={`rounded-2xl p-3 border ${accentClass}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-80">
        {label}
      </p>
      <p className="mt-1 font-mono text-xl font-black tabular-nums leading-none">
        {value}
      </p>
      {subValue && (
        <p className="mt-1 text-[10px] text-text-muted leading-tight">
          {subValue}
        </p>
      )}
    </div>
  );
}
