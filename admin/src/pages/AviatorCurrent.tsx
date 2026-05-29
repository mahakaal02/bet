import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useVisiblePolling } from '../lib/useVisiblePolling';

interface CurrentRound {
  phase: string | null;
  roundId: string | null;
  roundNumber: number | null;
  startedAt: string | null;
  onlineCount: number;
  bettorsThisRound: number;
  totalStaked: number;
  totalPaidOut: number;
}

interface Bet {
  betId: string;
  userId: string;
  username: string;
  amount: number;
  autoCashoutAt: number | null;
  cashedOutAt: number | null;
  payout: number | null;
}

type SortKey = 'amount' | 'username' | 'cashedOutAt' | 'payout';
type SortDir = 'asc' | 'desc';

/**
 * Per-user breakdown of the current Aviator round. The list is live —
 * polled every 2s — so the admin watches stakes flow in during the
 * BETTING window and cashouts flip in real time during RUNNING. After
 * the round CRASHED, the list freezes on the final settled state.
 *
 * Columns + sort: amount, username, cashed-out multiplier, payout.
 * Filter: username substring + an "only cashed out" toggle.
 */
export default function AviatorCurrent() {
  const [meta, setMeta] = useState<CurrentRound | null>(null);
  const [bets, setBets] = useState<Bet[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>('amount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [search, setSearch] = useState('');
  const [onlyCashedOut, setOnlyCashedOut] = useState(false);

  async function refresh() {
    try {
      const [m, b] = await Promise.all([
        api.get<CurrentRound>('/admin/aviator/current'),
        api.get<Bet[]>('/admin/aviator/current/bets'),
      ]);
      setMeta(m);
      setBets(b);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'failed to load');
    }
  }

  // Poll every 2s, but only while the tab is visible (see hook).
  useVisiblePolling(refresh, 2_000);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return [...bets]
      .filter((b) => (onlyCashedOut ? b.cashedOutAt !== null : true))
      .filter((b) => (needle ? b.username.toLowerCase().includes(needle) : true))
      .sort((a, b) => {
        let diff = 0;
        if (sortKey === 'amount') diff = a.amount - b.amount;
        else if (sortKey === 'username') diff = a.username.localeCompare(b.username);
        else if (sortKey === 'cashedOutAt')
          diff = (a.cashedOutAt ?? -1) - (b.cashedOutAt ?? -1);
        else diff = (a.payout ?? -1) - (b.payout ?? -1);
        return sortDir === 'asc' ? diff : -diff;
      });
  }, [bets, search, onlyCashedOut, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setSortDir(key === 'username' ? 'asc' : 'desc');
    }
  }

  const atRisk = (meta?.totalStaked ?? 0) - (meta?.totalPaidOut ?? 0);

  return (
    <div>
      <div className="mb-4">
        <Link to="/aviator/analytics" className="text-xs text-slate-500 hover:text-slate-700">
          ← Back to analytics
        </Link>
        <h1 className="text-2xl font-semibold mt-1">
          Current round{' '}
          {meta?.roundNumber != null && (
            <span className="text-slate-400 font-normal">#{meta.roundNumber}</span>
          )}
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {meta?.phase ?? '—'} ·{' '}
          {meta?.bettorsThisRound ?? 0} active bettors ·{' '}
          ₹{(meta?.totalStaked ?? 0).toLocaleString()} staked ·{' '}
          ₹{(meta?.totalPaidOut ?? 0).toLocaleString()} cashed out ·{' '}
          <span className="font-semibold text-amber-700">
            ₹{atRisk.toLocaleString()} at risk
          </span>
        </p>
      </div>

      {error && (
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-3 mb-4">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4 flex flex-wrap items-center gap-3 text-sm">
        <input
          type="text"
          placeholder="Filter by username…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 border border-slate-300 rounded text-sm w-48"
        />
        <label className="inline-flex items-center gap-2 text-slate-700">
          <input
            type="checkbox"
            checked={onlyCashedOut}
            onChange={(e) => setOnlyCashedOut(e.target.checked)}
            className="rounded border-slate-300"
          />
          Only cashed out
        </label>
        <div className="ml-auto text-xs text-slate-500">
          Auto-refresh every 2s
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
            <tr>
              <SortHeader
                label="User"
                active={sortKey === 'username'}
                dir={sortDir}
                onClick={() => toggleSort('username')}
              />
              <SortHeader
                label="Stake"
                align="right"
                active={sortKey === 'amount'}
                dir={sortDir}
                onClick={() => toggleSort('amount')}
              />
              <th className="px-3 py-2 text-right font-medium">Auto cashout</th>
              <SortHeader
                label="Cashed out @"
                align="right"
                active={sortKey === 'cashedOutAt'}
                dir={sortDir}
                onClick={() => toggleSort('cashedOutAt')}
              />
              <SortHeader
                label="Payout"
                align="right"
                active={sortKey === 'payout'}
                dir={sortDir}
                onClick={() => toggleSort('payout')}
              />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  No bets on this round{search || onlyCashedOut ? ' match filters' : ''}.
                </td>
              </tr>
            ) : (
              visible.map((b) => (
                <tr key={b.betId} className="border-t border-slate-200">
                  <td className="px-3 py-2 font-medium text-slate-900">
                    @{b.username}
                    <div className="text-[10px] text-slate-500 font-mono">
                      {b.userId.slice(0, 8)}…
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    ₹{b.amount.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-slate-500">
                    {b.autoCashoutAt != null
                      ? `${b.autoCashoutAt.toFixed(2)}×`
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {b.cashedOutAt != null ? (
                      <span className="text-emerald-700">
                        {b.cashedOutAt.toFixed(2)}×
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td
                    className={
                      'px-3 py-2 text-right font-mono ' +
                      (b.payout != null && b.payout > 0
                        ? 'text-emerald-700'
                        : 'text-slate-400')
                    }
                  >
                    {b.payout != null ? `₹${b.payout.toLocaleString()}` : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  align,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: 'right';
}) {
  return (
    <th
      onClick={onClick}
      className={
        'px-3 py-2 font-medium cursor-pointer select-none hover:text-slate-900 ' +
        (align === 'right' ? 'text-right' : 'text-left')
      }
    >
      {label}
      <span
        className={`ml-1 text-[10px] ${active ? 'text-slate-700' : 'text-slate-300'}`}
      >
        {active ? (dir === 'asc' ? '▲' : '▼') : '▾'}
      </span>
    </th>
  );
}
