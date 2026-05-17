'use client';

import { useGame } from '@/lib/store';

export default function WinnersPanel() {
  const winners = useGame((s) => s.recentWinners);

  return (
    <aside className="glass rounded-3xl p-4 flex flex-col" style={{ minHeight: 240 }}>
      <h2 className="text-xs uppercase tracking-widest text-text-secondary mb-3">
        Recent winners
      </h2>

      {winners.length === 0 ? (
        <p className="text-text-secondary text-sm">
          No cashouts yet this session.
        </p>
      ) : (
        <ul className="space-y-1.5 overflow-y-auto max-h-[260px] pr-1">
          {winners.map((w, i) => (
            <li
              key={`${w.roundNumber}-${w.username}-${i}`}
              className="flex items-center justify-between text-xs px-2 py-1.5 rounded-lg bg-elevated/60"
            >
              <span className="font-medium truncate">{w.username}</span>
              <div className="flex items-center gap-2 font-mono whitespace-nowrap">
                <span className="text-neon-green">{w.multiplier.toFixed(2)}×</span>
                <span>+₹{w.payout.toLocaleString()}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
