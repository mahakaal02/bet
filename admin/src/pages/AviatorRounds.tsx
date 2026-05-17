import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

interface RoundRow {
  id: string;
  roundNumber: number;
  crashMultiplier: string;
  startedAt: string;
  crashedAt: string;
  seedId: string | null;
  nonce: number | null;
}

const PAGE_SIZE = 100;

export default function AviatorRounds() {
  const [rows, setRows] = useState<RoundRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  async function loadInitial() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<RoundRow[]>(`/admin/aviator/rounds?limit=${PAGE_SIZE}`);
      setRows(data);
      setExhausted(data.length < PAGE_SIZE);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'failed to load');
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (rows.length === 0 || exhausted) return;
    setLoading(true);
    setError(null);
    try {
      const last = rows[rows.length - 1].roundNumber;
      const data = await api.get<RoundRow[]>(
        `/admin/aviator/rounds?limit=${PAGE_SIZE}&before=${last}`,
      );
      setRows((cur) => [...cur, ...data]);
      if (data.length < PAGE_SIZE) setExhausted(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadInitial();
  }, []);

  function exportCsv() {
    const header = 'round_number,started_at,crashed_at,crash_multiplier,seed_id,nonce\n';
    const body = rows
      .map((r) =>
        [
          r.roundNumber,
          r.startedAt,
          r.crashedAt,
          r.crashMultiplier,
          r.seedId ?? '',
          r.nonce ?? '',
        ].join(','),
      )
      .join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kalki-bet-round-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function pillFor(m: number) {
    if (m < 1.2) return 'bg-red-100 text-red-800 border border-red-300';
    if (m < 2) return 'bg-amber-100 text-amber-800 border border-amber-300';
    if (m < 5) return 'bg-blue-100 text-blue-800 border border-blue-300';
    return 'bg-emerald-100 text-emerald-800 border border-emerald-300';
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Round log</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={loadInitial}
            className="px-3 py-1.5 text-xs font-medium rounded bg-slate-100 text-slate-700 hover:bg-slate-200 transition"
            disabled={loading}
          >
            Refresh
          </button>
          <button
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="px-3 py-1.5 text-xs font-medium rounded bg-brand-indigo text-white hover:bg-brand-indigo-dark transition disabled:opacity-50"
          >
            Export CSV ({rows.length} rows)
          </button>
        </div>
      </div>

      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Round</th>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Time</th>
              <th className="px-4 py-3 font-medium">Multiplier</th>
              <th className="px-4 py-3 font-medium">Duration</th>
              <th className="px-4 py-3 font-medium">Seed</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No rounds logged yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const m = Number(r.crashMultiplier);
                const dur =
                  r.startedAt && r.crashedAt
                    ? ((new Date(r.crashedAt).getTime() -
                        new Date(r.startedAt).getTime()) /
                        1000).toFixed(1) + 's'
                    : '—';
                const date = new Date(r.crashedAt);
                return (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-mono">#{r.roundNumber}</td>
                    <td className="px-4 py-2 text-slate-700 whitespace-nowrap">
                      {date.toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2 text-slate-700 font-mono whitespace-nowrap">
                      {date.toLocaleTimeString()}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-mono ${pillFor(m)}`}>
                        {m.toFixed(2)}×
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-slate-600">{dur}</td>
                    <td className="px-4 py-2 font-mono text-slate-500 text-xs">
                      {r.seedId ? `${r.seedId.slice(0, 8)}… #${r.nonce ?? '—'}` : '—'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-center">
        {!exhausted ? (
          <button
            onClick={loadMore}
            disabled={loading || rows.length === 0}
            className="px-4 py-2 text-sm font-medium rounded bg-slate-100 text-slate-700 hover:bg-slate-200 transition disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        ) : (
          <div className="text-xs text-slate-500">End of log.</div>
        )}
      </div>
    </div>
  );
}
