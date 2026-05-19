'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useGame } from '@/lib/store';
import { tierFor } from '@/lib/tiers';
import { formatCoins } from '@/lib/format';

/**
 * Recent winners ticker. Cross-round persistent (unlike the roster
 * which clears each BETTING phase), so this is where players see who
 * just hit a big multiplier on any of the last ~20 rounds.
 *
 * Sorting matches the server order (most recent first). Each row
 * tier-tints the multiplier and shows the payout in mono.
 */
export default function WinnersPanel() {
  const winners = useGame((s) => s.recentWinners);

  return (
    <aside
      className="glass rounded-3xl flex flex-col overflow-hidden"
      style={{ minHeight: 240 }}
    >
      <header className="px-4 pt-4 pb-3 border-b border-divider flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-[0.20em] text-text-secondary">
          Recent winners
        </h2>
        <span className="font-mono text-xs text-text-secondary">
          {winners.length}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto scroll-cool px-2 py-2 space-y-1 max-h-[300px]">
        {winners.length === 0 ? (
          <p className="text-text-muted text-xs px-2 py-3">
            No cashouts yet this session.
          </p>
        ) : (
          <AnimatePresence initial={false}>
            {winners.map((w, i) => {
              const tier = tierFor(w.multiplier);
              return (
                <motion.div
                  key={`${w.roundNumber}-${w.username}-${i}`}
                  layout
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 340, damping: 26 }}
                  className="flex items-center justify-between gap-3 px-2 py-1.5 rounded-lg border"
                  style={{
                    backgroundColor: `${tier.color}0F`,
                    borderColor: `${tier.color}22`,
                  }}
                >
                  <span className="truncate text-xs font-semibold text-text-primary">
                    {w.username}
                  </span>
                  <div className="flex items-center gap-2 font-mono whitespace-nowrap text-xs">
                    <span
                      className="font-bold tabular-nums"
                      style={{ color: tier.color }}
                    >
                      {w.multiplier.toFixed(2)}×
                    </span>
                    <span className="text-text-secondary tabular-nums">
                      +{formatCoins(w.payout)}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </aside>
  );
}
