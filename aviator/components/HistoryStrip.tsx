'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useGame } from '@/lib/store';
import { tierFor } from '@/lib/tiers';
import { formatMultiplier } from '@/lib/format';

/**
 * Recent-rounds rail. Tier-tinted chips, horizontally scrollable on
 * small screens. The freshest crash is on the left and animates in
 * from the top — gives the player a felt "another round just ended"
 * beat without needing a sound.
 *
 * Legendary crashes (≥10×) shimmer; everything below uses a static
 * tier-tinted chip so the rail doesn't strobe.
 */
export default function HistoryStrip() {
  const history = useGame((s) => s.history);

  return (
    <div className="glass rounded-2xl px-3 py-2 lg:rounded-3xl lg:px-4 lg:py-2.5">
      <div className="flex items-center gap-3">
        <span className="hidden sm:inline-block text-[10px] font-bold uppercase tracking-[0.22em] text-text-secondary whitespace-nowrap">
          Recent
        </span>
        <div className="relative flex-1 overflow-hidden fade-edge-x">
          <div className="flex gap-1.5 overflow-x-auto scroll-cool min-w-max">
            <AnimatePresence initial={false}>
              {history.length === 0 && (
                <motion.span
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-text-muted text-xs px-2 py-1"
                >
                  Waiting for first round…
                </motion.span>
              )}
              {/* Cap at 10 chips so the rail stays scannable on phones.
                  The store keeps up to 30 historical rounds (see
                  `aviator/lib/store.ts::onCrash`); the rail is the
                  scrollable lens onto the most-recent slice. Players
                  can swipe horizontally to reveal older entries — the
                  parent container has `overflow-x-auto` and the inner
                  flex is `min-w-max`. */}
              {history.slice(0, 10).map((h, idx) => {
                const tier = tierFor(h.crashMultiplier);
                const isLegendary = h.crashMultiplier >= 10;
                return (
                  <motion.div
                    key={h.roundNumber}
                    layout
                    initial={
                      idx === 0
                        ? { opacity: 0, y: -8, scale: 0.85 }
                        : { opacity: 1, scale: 1 }
                    }
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 360, damping: 26 }}
                    className="relative px-2.5 py-1 rounded-full text-[11px] font-mono font-bold border"
                    style={{
                      borderColor: `${tier.color}50`,
                      backgroundColor: `${tier.color}1A`,
                      color: tier.color,
                    }}
                    title={`Round #${h.roundNumber} — ${tier.label}`}
                  >
                    {isLegendary ? (
                      <span className="shimmer-text">
                        {formatMultiplier(h.crashMultiplier)}
                      </span>
                    ) : (
                      <span className="tabular-nums">
                        {formatMultiplier(h.crashMultiplier)}
                      </span>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
