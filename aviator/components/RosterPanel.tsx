'use client';

import { useGame } from '@/lib/store';

// Deterministic username colour from the brand palette (so demo1 is always
// the same shade across renders).
const COLORS = ['#FF4D5A', '#FF8C42', '#2EE59D', '#FFCD56', '#8A6BFF', '#5DADE2'];
function colorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

export default function RosterPanel() {
  const roster = useGame((s) => s.roster);
  const phase = useGame((s) => s.phase);

  const cashedOut = roster.filter((b) => b.cashedOutAt !== null);
  const active = roster.filter((b) => b.cashedOutAt === null);

  return (
    <aside className="glass rounded-3xl p-4 flex flex-col" style={{ minHeight: 380 }}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs uppercase tracking-widest text-text-secondary">
          Players
        </h2>
        <span className="text-xs font-mono text-text-secondary">
          {roster.length}
        </span>
      </div>

      {roster.length === 0 ? (
        <p className="text-text-secondary text-sm">
          {phase === 'BETTING' ? 'No bets yet for this round.' : 'No bets placed.'}
        </p>
      ) : (
        <div className="space-y-1.5 overflow-y-auto max-h-[420px] pr-1">
          {active.map((b) => (
            <RosterRow key={`a-${b.username}`} {...b} status="active" />
          ))}
          {cashedOut.length > 0 && (
            <div className="pt-2 border-t border-divider mt-2 space-y-1.5">
              <div className="text-[10px] uppercase tracking-widest text-text-secondary px-1">
                Cashed out
              </div>
              {cashedOut.map((b) => (
                <RosterRow key={`c-${b.username}`} {...b} status="done" />
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function RosterRow({
  username,
  amount,
  autoCashoutAt,
  cashedOutAt,
  status,
}: {
  username: string;
  amount: number;
  autoCashoutAt: number | null;
  cashedOutAt: number | null;
  status: 'active' | 'done';
}) {
  const color = colorFor(username);
  return (
    <div
      className="flex items-center justify-between text-xs px-2 py-1.5 rounded-lg bg-elevated/60"
      style={status === 'done' ? { opacity: 0.6 } : undefined}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: color }}
        />
        <span className="font-medium truncate" style={{ color }}>
          {username}
        </span>
      </div>
      <div className="flex items-center gap-2 font-mono whitespace-nowrap">
        <span>₹{amount}</span>
        {cashedOutAt !== null ? (
          <span className="text-neon-green">
            {cashedOutAt.toFixed(2)}×
          </span>
        ) : autoCashoutAt !== null ? (
          <span className="text-accent-orange">
            auto {autoCashoutAt.toFixed(2)}×
          </span>
        ) : (
          <span className="text-text-secondary">—</span>
        )}
      </div>
    </div>
  );
}
