import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';

type Period = 'round' | 'day' | 'month' | 'fy';

interface RoundPnl {
  roundId: string;
  roundNumber: number;
  startedAt: string;
  crashedAt: string | null;
  crashMultiplier: string;
  bettorCount: number;
  totalStaked: number;
  totalPaidOut: number;
  houseProfit: number;
}

interface Rollup {
  periodKey: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  totalStaked: number;
  totalPaidOut: number;
  houseProfit: number;
  roundCount: number;
  bettorCount: number;
}

const TABS: { key: Period; label: string }[] = [
  { key: 'round', label: 'Per round' },
  { key: 'day', label: 'Daily' },
  { key: 'month', label: 'Monthly' },
  { key: 'fy', label: 'Financial year' },
];

/**
 * House-side finance view. Four tabs: per-round, per-day, per-month,
 * per-FY (Apr 1 – Mar 31, Indian fiscal convention). Each table shows
 * stake / payout / house P&L for the period, plus a grand-total row
 * across the visible page so the admin doesn't have to do mental
 * arithmetic.
 */
export default function AviatorFinance() {
  const [period, setPeriod] = useState<Period>('round');
  const [perRound, setPerRound] = useState<RoundPnl[] | null>(null);
  const [rollup, setRollup] = useState<Rollup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      if (period === 'round') {
        const data = await api.get<RoundPnl[]>(
          '/admin/aviator/rounds-pnl?limit=200',
        );
        setPerRound(data);
        setRollup(null);
      } else {
        const data = await api.get<Rollup[]>(
          `/admin/aviator/finance-rollup?period=${period}&limit=60`,
        );
        setRollup(data);
        setPerRound(null);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [period]);

  // Page-level totals across whatever rows are currently visible. For
  // per-round this is "last 200 rounds"; for rollups it's "last N
  // periods". Always useful to glance at the bottom of the screen.
  const totals = useMemo(() => {
    const rows: Array<{ stake: number; paid: number; profit: number }> = (
      period === 'round'
        ? perRound ?? []
        : rollup ?? []
    ).map((r) =>
      'totalStaked' in r
        ? {
            stake: r.totalStaked,
            paid: r.totalPaidOut,
            profit: r.houseProfit,
          }
        : { stake: 0, paid: 0, profit: 0 },
    );
    return rows.reduce(
      (acc, x) => ({
        stake: acc.stake + x.stake,
        paid: acc.paid + x.paid,
        profit: acc.profit + x.profit,
      }),
      { stake: 0, paid: 0, profit: 0 },
    );
  }, [period, perRound, rollup]);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Aviator finance</h1>
      <p className="text-sm text-slate-500 mb-4">
        House-side stakes, payouts, and P&amp;L. FY tab uses the Indian
        fiscal calendar (Apr 1 – Mar 31).
      </p>

      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg mb-4 inline-flex">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setPeriod(t.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded transition ${
              period === t.key
                ? 'bg-white shadow-sm text-slate-900'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-3 mb-4">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-6 text-slate-500 text-sm">Loading…</div>
        ) : period === 'round' ? (
          <PerRoundTable rows={perRound ?? []} totals={totals} />
        ) : (
          <RollupTable rows={rollup ?? []} totals={totals} period={period} />
        )}
      </div>
    </div>
  );
}

function PerRoundTable({
  rows,
  totals,
}: {
  rows: RoundPnl[];
  totals: { stake: number; paid: number; profit: number };
}) {
  if (rows.length === 0) {
    return <div className="p-6 text-slate-500 text-sm">No rounds yet.</div>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
        <tr>
          <th className="px-3 py-2 text-left font-medium">Round</th>
          <th className="px-3 py-2 text-left font-medium">Crashed</th>
          <th className="px-3 py-2 text-right font-medium">Crash ×</th>
          <th className="px-3 py-2 text-right font-medium">Bettors</th>
          <th className="px-3 py-2 text-right font-medium">Staked</th>
          <th className="px-3 py-2 text-right font-medium">Paid out</th>
          <th className="px-3 py-2 text-right font-medium">House P&amp;L</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.roundId} className="border-t border-slate-200">
            <td className="px-3 py-2 font-mono">#{r.roundNumber}</td>
            <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
              {r.crashedAt ? new Date(r.crashedAt).toLocaleString() : '—'}
            </td>
            <td className="px-3 py-2 text-right font-mono">
              {Number(r.crashMultiplier).toFixed(2)}×
            </td>
            <td className="px-3 py-2 text-right font-mono text-slate-500">
              {r.bettorCount}
            </td>
            <td className="px-3 py-2 text-right font-mono">
              ₹{r.totalStaked.toLocaleString()}
            </td>
            <td className="px-3 py-2 text-right font-mono">
              ₹{r.totalPaidOut.toLocaleString()}
            </td>
            <td
              className={
                'px-3 py-2 text-right font-mono font-semibold ' +
                (r.houseProfit > 0
                  ? 'text-emerald-700'
                  : r.houseProfit < 0
                    ? 'text-rose-700'
                    : 'text-slate-500')
              }
            >
              {r.houseProfit >= 0 ? '+' : ''}₹{r.houseProfit.toLocaleString()}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot className="bg-slate-50">
        <tr>
          <td colSpan={4} className="px-3 py-2 text-xs uppercase text-slate-500 font-semibold">
            Page total ({rows.length} rounds)
          </td>
          <td className="px-3 py-2 text-right font-mono font-semibold">
            ₹{totals.stake.toLocaleString()}
          </td>
          <td className="px-3 py-2 text-right font-mono font-semibold">
            ₹{totals.paid.toLocaleString()}
          </td>
          <td
            className={
              'px-3 py-2 text-right font-mono font-bold ' +
              (totals.profit > 0
                ? 'text-emerald-700'
                : totals.profit < 0
                  ? 'text-rose-700'
                  : 'text-slate-500')
            }
          >
            {totals.profit >= 0 ? '+' : ''}₹{totals.profit.toLocaleString()}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function RollupTable({
  rows,
  totals,
  period,
}: {
  rows: Rollup[];
  totals: { stake: number; paid: number; profit: number };
  period: 'day' | 'month' | 'fy';
}) {
  if (rows.length === 0) {
    return (
      <div className="p-6 text-slate-500 text-sm">
        No data for this {period === 'fy' ? 'fiscal year' : period} yet.
      </div>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
        <tr>
          <th className="px-3 py-2 text-left font-medium">
            {period === 'fy' ? 'Fiscal year' : period === 'month' ? 'Month' : 'Day'}
          </th>
          <th className="px-3 py-2 text-right font-medium">Rounds</th>
          <th className="px-3 py-2 text-right font-medium">Bettors</th>
          <th className="px-3 py-2 text-right font-medium">Staked</th>
          <th className="px-3 py-2 text-right font-medium">Paid out</th>
          <th className="px-3 py-2 text-right font-medium">House P&amp;L</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.periodKey} className="border-t border-slate-200">
            <td className="px-3 py-2 font-medium">{r.periodLabel}</td>
            <td className="px-3 py-2 text-right font-mono text-slate-500">
              {r.roundCount}
            </td>
            <td className="px-3 py-2 text-right font-mono text-slate-500">
              {r.bettorCount}
            </td>
            <td className="px-3 py-2 text-right font-mono">
              ₹{r.totalStaked.toLocaleString()}
            </td>
            <td className="px-3 py-2 text-right font-mono">
              ₹{r.totalPaidOut.toLocaleString()}
            </td>
            <td
              className={
                'px-3 py-2 text-right font-mono font-semibold ' +
                (r.houseProfit > 0
                  ? 'text-emerald-700'
                  : r.houseProfit < 0
                    ? 'text-rose-700'
                    : 'text-slate-500')
              }
            >
              {r.houseProfit >= 0 ? '+' : ''}₹{r.houseProfit.toLocaleString()}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot className="bg-slate-50">
        <tr>
          <td colSpan={3} className="px-3 py-2 text-xs uppercase text-slate-500 font-semibold">
            Net total ({rows.length} {period === 'fy' ? 'FYs' : period === 'month' ? 'months' : 'days'})
          </td>
          <td className="px-3 py-2 text-right font-mono font-semibold">
            ₹{totals.stake.toLocaleString()}
          </td>
          <td className="px-3 py-2 text-right font-mono font-semibold">
            ₹{totals.paid.toLocaleString()}
          </td>
          <td
            className={
              'px-3 py-2 text-right font-mono font-bold ' +
              (totals.profit > 0
                ? 'text-emerald-700'
                : totals.profit < 0
                  ? 'text-rose-700'
                  : 'text-slate-500')
            }
          >
            {totals.profit >= 0 ? '+' : ''}₹{totals.profit.toLocaleString()}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
