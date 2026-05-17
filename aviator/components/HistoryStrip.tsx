'use client';

import { useGame } from '@/lib/store';

function colorFor(m: number) {
  if (m < 1.5) return 'bg-accent-red/20 text-accent-red border-accent-red/40';
  if (m < 2) return 'bg-accent-orange/20 text-accent-orange border-accent-orange/40';
  return 'bg-neon-green/20 text-neon-green border-neon-green/40';
}

export default function HistoryStrip() {
  const history = useGame((s) => s.history);
  if (history.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-2 px-1 py-2 min-w-max">
        {history.slice(0, 16).map((h) => (
          <div
            key={h.roundNumber}
            className={`px-3 py-1 rounded-full text-xs font-mono border ${colorFor(h.crashMultiplier)}`}
            title={`Round ${h.roundNumber}`}
          >
            {h.crashMultiplier.toFixed(2)}×
          </div>
        ))}
      </div>
    </div>
  );
}
