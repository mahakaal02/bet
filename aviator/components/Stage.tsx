'use client';

import { useGame } from '@/lib/store';
import GameStage from './GameStage';
import MultiplierDisplay from './MultiplierDisplay';

/**
 * Stage container — owns the aspect ratio, layered DOM stack
 * (canvas behind, multiplier readout in front), and the round-edge
 * shake that fires on crash.
 *
 * The two children are decoupled on purpose:
 *   - GameStage renders particles, the curve, the mascot.
 *   - MultiplierDisplay renders the big number, badge, countdown.
 *
 * Keeping them separate means the canvas can repaint at 60 fps
 * without React having to re-render the text element every frame.
 */
export default function Stage() {
  const phase = useGame((s) => s.phase);
  return (
    <div
      className={`relative w-full overflow-hidden rounded-[28px] border border-border bg-surface/40 stage-grain ${
        phase === 'CRASHED' ? 'crash-shake' : ''
      }`}
      style={{ aspectRatio: 'var(--stage-aspect, 16 / 9)' }}
    >
      <GameStage />

      {/* Small top-centre status pill. The big multiplier number is
          drawn inside the canvas next to the mascot — this overlay
          only carries the round-phase metadata. */}
      <div className="absolute inset-x-0 top-3 flex justify-center pointer-events-none z-10">
        <MultiplierDisplay />
      </div>

      {/* Bottom-edge gradient — guarantees text on the curve always
          reads against a darker base no matter what colour the canvas
          paints behind it. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-bg/80 to-transparent" />
    </div>
  );
}
