import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';

interface Analytics {
  sinceHours: number;
  totalRounds: number;
  avgCrash: number;
  totalBets: number;
  totalStaked: number;
  totalPaidOut: number;
  houseEdgeInr: number;
  cashoutCount: number;
  cashoutRate: number;
  histogram: { label: string; count: number }[];
  onlineCount: number;
  currentPhase: string;
  currentRoundNumber: number | null;
}

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

export default function AviatorAnalytics() {
  const [data, setData] = useState<Analytics | null>(null);
  const [current, setCurrent] = useState<CurrentRound | null>(null);
  const [hours, setHours] = useState(24);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      // The two endpoints are independent; firing them in parallel
      // keeps the live tiles responsive even when the historical
      // analytics aggregate is slow on big windows.
      const [a, c] = await Promise.all([
        api.get<Analytics>(`/admin/aviator/analytics?hours=${hours}`),
        api.get<CurrentRound>('/admin/aviator/current'),
      ]);
      setData(a);
      setCurrent(c);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'failed to load');
    }
  }

  useEffect(() => {
    refresh();
    // 3s pulls keep the bettor + stake tiles "live enough" without
    // hammering the backend. The historical analytics under it stays
    // on the slower 10s cadence implicit in the page render.
    const id = setInterval(refresh, 3_000);
    return () => clearInterval(id);
  }, [hours]);

  if (!data) {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-6">Aviator analytics</h1>
        {error ? (
          <div className="text-red-600 text-sm">{error}</div>
        ) : (
          <div className="text-slate-500">Loading…</div>
        )}
      </div>
    );
  }

  const maxHist = Math.max(1, ...data.histogram.map((b) => b.count));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Aviator analytics</h1>
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {[1, 6, 24, 168].map((h) => (
            <button
              key={h}
              onClick={() => setHours(h)}
              className={`px-3 py-1.5 text-xs font-medium rounded ${
                hours === h
                  ? 'bg-white shadow-sm text-slate-900'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {h === 168 ? '7d' : `${h}h`}
            </button>
          ))}
        </div>
      </div>

      {/* Live tiles — current-round metrics. The stake tile drills
          down into the per-user bet list. Updates every 3s. */}
      <div className="mb-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
          Live · {current?.phase ?? '—'} · round #{current?.roundNumber ?? '—'}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat
            label="Active bettors"
            value={current?.bettorsThisRound ?? 0}
            sub={`${current?.onlineCount ?? 0} online (incl. viewers)`}
          />
          <Link to="/aviator/current" className="block">
            <Stat
              label="Coins on this round"
              value={`₹${(current?.totalStaked ?? 0).toLocaleString()}`}
              sub="Click for per-user breakdown →"
              clickable
            />
          </Link>
          <Stat
            label="Cashed out so far"
            value={`₹${(current?.totalPaidOut ?? 0).toLocaleString()}`}
            sub="(live, this round only)"
          />
          <Stat
            label="At risk"
            value={`₹${Math.max(
              0,
              (current?.totalStaked ?? 0) - (current?.totalPaidOut ?? 0),
            ).toLocaleString()}`}
            sub="Pending settlement"
          />
        </div>
      </div>

      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
        Historical · last {hours === 168 ? '7 days' : `${hours}h`}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <Stat label="Rounds" value={data.totalRounds.toLocaleString()} sub={`avg crash ${data.avgCrash.toFixed(2)}×`} />
        <Stat label="Bets" value={data.totalBets.toLocaleString()} sub={`₹${data.totalStaked.toLocaleString()} staked`} />
        <Stat label="House edge" value={`₹${data.houseEdgeInr.toLocaleString()}`} sub={`payout ₹${data.totalPaidOut.toLocaleString()}`} />
        <Stat label="Cashout rate" value={`${data.cashoutRate}%`} sub={`${data.cashoutCount} of ${data.totalBets}`} />
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 max-w-3xl">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Crash distribution</h2>
        <div className="space-y-2">
          {data.histogram.map((b) => (
            <div key={b.label} className="flex items-center gap-3 text-sm">
              <div className="w-24 text-slate-600 font-mono text-xs">{b.label}</div>
              <div className="flex-1 bg-slate-100 rounded h-6 relative overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-rose-400 to-amber-400 rounded"
                  style={{ width: `${(b.count / maxHist) * 100}%` }}
                />
              </div>
              <div className="w-12 text-right font-mono text-xs text-slate-700">{b.count}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  clickable,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  clickable?: boolean;
}) {
  return (
    <div
      className={
        'bg-white rounded-lg shadow-sm border border-slate-200 p-4 ' +
        (clickable
          ? 'hover:border-brand-indigo hover:shadow transition cursor-pointer'
          : '')
      }
    >
      <div className="text-xs uppercase tracking-widest text-slate-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}
