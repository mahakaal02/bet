import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

interface SeedsResp {
  current: {
    seedId: string;
    serverSeedHash: string;
    clientSeed: string;
  } | null;
  revealed: {
    id: string;
    serverSeed: string;
    serverSeedHash: string;
    clientSeed: string;
    startRoundNumber: number | null;
    endRoundNumber: number | null;
    startedAt: string;
    revealedAt: string;
    rotationReason: string | null;
  }[];
}

export default function AviatorSeeds() {
  const [data, setData] = useState<SeedsResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  async function refresh() {
    setError(null);
    try {
      setData(await api.get<SeedsResp>('/admin/aviator/seeds?limit=50'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'failed to load');
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function rotate() {
    if (!confirm(
      'Rotate the active seed now? This reveals the current seed (users can verify all rounds it covered) and mints a new one.',
    )) return;
    setRotating(true);
    try {
      await api.post('/admin/aviator/seed/rotate', {});
      await refresh();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'rotate failed');
    } finally {
      setRotating(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Aviator seeds</h1>
        <button
          onClick={rotate}
          disabled={rotating || !data?.current}
          className="px-4 py-2 rounded bg-brand-indigo text-white text-sm font-medium hover:bg-brand-indigo-dark transition disabled:opacity-50"
        >
          {rotating ? 'Rotating…' : 'Rotate active seed'}
        </button>
      </div>

      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

      {data?.current && (
        <section className="bg-white rounded-lg shadow-sm border border-slate-200 p-5 mb-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Active seed</h2>
          <Kv label="seedId" value={data.current.seedId} />
          <Kv label="serverSeedHash" value={data.current.serverSeedHash} mono />
          <Kv label="clientSeed" value={data.current.clientSeed} mono />
          <p className="mt-3 text-xs text-slate-500">
            The seed itself is hidden until rotation. Verification of past rounds uses the
            revealed seeds below.
          </p>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">
          Revealed seeds ({data?.revealed.length ?? 0})
        </h2>
        {!data ? (
          <div className="text-slate-500">Loading…</div>
        ) : data.revealed.length === 0 ? (
          <div className="text-slate-500 text-sm">No rotations yet.</div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Hash</th>
                  <th className="px-4 py-2 font-medium">Rounds</th>
                  <th className="px-4 py-2 font-medium">Revealed at</th>
                  <th className="px-4 py-2 font-medium">Reason</th>
                  <th className="px-4 py-2 font-medium">Seed (revealed)</th>
                </tr>
              </thead>
              <tbody>
                {data.revealed.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-mono text-slate-500">
                      {s.serverSeedHash.slice(0, 16)}…
                    </td>
                    <td className="px-4 py-2 font-mono">
                      #{s.startRoundNumber ?? '—'} – #{s.endRoundNumber ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {new Date(s.revealedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{s.rotationReason ?? '—'}</td>
                    <td className="px-4 py-2 font-mono text-slate-500" title={s.serverSeed}>
                      {s.serverSeed.slice(0, 16)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Kv({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 text-sm py-1">
      <span className="w-32 text-slate-500 text-xs">{label}</span>
      <span className={`text-slate-800 ${mono ? 'font-mono break-all' : ''}`}>{value}</span>
    </div>
  );
}
