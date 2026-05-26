'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGame } from '@/lib/store';
import { tierFor } from '@/lib/tiers';
import { formatMultiplier } from '@/lib/format';
import { useTranslation, type TranslateFunction } from '@/lib/i18n/client';

/**
 * Recent-rounds rail. Tier-tinted chips, horizontally scrollable on
 * small screens. The freshest crash is on the left and animates in
 * from the top — gives the player a felt "another round just ended"
 * beat without needing a sound.
 *
 * Legendary crashes (≥10×) shimmer; everything below uses a static
 * tier-tinted chip so the rail doesn't strobe.
 *
 * The strip also exposes a "Round History" overlay — tap the trailing
 * `…` button to expand into a full-history modal showing up to 28
 * past crashes in a grid (matches the layout players are used to from
 * other Aviator-family games). Tap outside or the close button to
 * dismiss. Escape works too.
 */

// How many chips ride along inside the strip. Keep this tight — the
// "…" expand button surfaces the full history on demand, so the
// strip itself just needs to be a quick at-a-glance feel of the last
// few rounds.
const INLINE_COUNT = 14;

// How many chips the expanded modal shows. Matches the player-
// familiar layout (2 rows × 14 ≈ 28). The store buffers 30
// entries (see `aviator/lib/store.ts::onCrash`), so we have headroom.
const EXPANDED_COUNT = 28;

export default function HistoryStrip() {
  const history = useGame((s) => s.history);
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();

  // Escape key closes the modal. Effect only attaches the listener
  // while the modal is open so we're not adding global handlers on
  // every render of the strip.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <div className="glass rounded-2xl px-3 py-2 lg:rounded-3xl lg:px-4 lg:py-2.5">
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-block text-[10px] font-bold uppercase tracking-[0.22em] text-text-secondary whitespace-nowrap">
            {t('game.recent')}
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
                    {t('game.waitingForFirstRound')}
                  </motion.span>
                )}
                {history.slice(0, INLINE_COUNT).map((h, idx) => (
                  <Chip
                    key={h.roundNumber}
                    roundNumber={h.roundNumber}
                    crashMultiplier={h.crashMultiplier}
                    animateIn={idx === 0}
                    t={t}
                  />
                ))}
              </AnimatePresence>
            </div>
          </div>

          {/* `…` expand button. Hidden when there's nothing to show. */}
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label={t('game.showFullHistory')}
              title={t('game.roundHistory')}
              className="shrink-0 grid h-7 w-7 place-items-center rounded-full border border-divider bg-elevated/60 text-text-secondary hover:text-text-primary hover:bg-elevated chip-press transition"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden
              >
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Expanded "Round History" overlay. Modal lives in a portal-
          like absolute layer so it floats above the canvas + bet
          controls without re-flowing them. */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm px-3 pt-3 sm:px-6 sm:pt-6"
            onClick={() => setOpen(false)}
            role="dialog"
            aria-label={t('game.roundHistory')}
            aria-modal="true"
          >
            <motion.div
              key="panel"
              initial={{ y: -16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -16, opacity: 0 }}
              transition={{ type: 'spring', damping: 26, stiffness: 280 }}
              onClick={(e) => e.stopPropagation()}
              className="mx-auto max-w-3xl glass-strong rounded-3xl p-4 sm:p-5 shadow-card"
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold tracking-[0.18em] uppercase text-text-primary">
                  {t('game.roundHistory')}
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t('game.closeRoundHistory')}
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

              {/* Grid layout: 7 cols on phone, 10 on small tablets,
                  14 on landscape / desktop. With EXPANDED_COUNT=28
                  this lands as 4 rows on phone, ~3 rows on tablet,
                  2 rows on landscape — matches the muscle-memory
                  layout players bring from other Aviator games. */}
              <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-10 md:gap-2 lg:grid-cols-14">
                {history.slice(0, EXPANDED_COUNT).map((h) => (
                  <Chip
                    key={h.roundNumber}
                    roundNumber={h.roundNumber}
                    crashMultiplier={h.crashMultiplier}
                    animateIn={false}
                    /* Center each chip in its grid cell — without
                       `place-self`, narrower chips would left-align
                       and leave ragged-looking gaps on the right. */
                    placeSelfCentre
                    t={t}
                  />
                ))}
              </div>

              {history.length === 0 && (
                <p className="py-8 text-center text-sm text-text-muted">
                  {t('game.noRoundsYet')}
                </p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * One round-result chip. Shared between the inline strip and the
 * expanded modal so the visual treatment never drifts between the
 * two surfaces.
 */
function Chip({
  roundNumber,
  crashMultiplier,
  animateIn,
  placeSelfCentre = false,
  t,
}: {
  roundNumber: number;
  crashMultiplier: number;
  animateIn: boolean;
  placeSelfCentre?: boolean;
  t: TranslateFunction;
}) {
  const tier = tierFor(crashMultiplier);
  const isLegendary = crashMultiplier >= 10;
  return (
    <motion.div
      layout
      initial={
        animateIn
          ? { opacity: 0, y: -8, scale: 0.85 }
          : { opacity: 1, scale: 1 }
      }
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 360, damping: 26 }}
      className={`relative px-2.5 py-1 rounded-full text-[11px] font-mono font-bold border ${
        placeSelfCentre ? 'place-self-center' : ''
      }`}
      style={{
        borderColor: `${tier.color}50`,
        backgroundColor: `${tier.color}1A`,
        color: tier.color,
      }}
      title={t('game.roundLabel', { n: roundNumber, tier: tier.label })}
    >
      {isLegendary ? (
        <span className="shimmer-text">{formatMultiplier(crashMultiplier)}</span>
      ) : (
        <span className="tabular-nums">{formatMultiplier(crashMultiplier)}</span>
      )}
    </motion.div>
  );
}
