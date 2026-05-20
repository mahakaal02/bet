import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

/**
 * Admin reconciliation viewer (PR-RECON-1).
 *
 * Two-pane layout — list of nightly reports on the left, drill-in on
 * the right showing per-user discrepancies + an ack button. The
 * trigger-now button manually fires the run for the current UTC day
 * (FINANCE-only via reconciliation.run perm; AUDITOR can read only).
 */

type Status = 'RUNNING' | 'COMPLETED' | 'FAILED';

interface ReportRow {
  id: string;
  forDate: string;
  status: Status;
  startedAt: string;
  completedAt: string | null;
  failureReason: string | null;
  usersChecked: number;
  usersOk: number;
  usersDiscrepant: number;
  totalAbsDrift: number;
}

interface DiscRow {
  id: string;
  userId: string;
  localSum: number;
  remoteSum: number;
  drift: number;
  notes: string | null;
  acknowledged: boolean;
  ackedBy: string | null;
  ackedAt: string | null;
  createdAt: string;
}

interface ReportDetail extends ReportRow {
  discrepancies: DiscRow[];
}

export default function Reconciliation() {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (cursor?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (cursor) params.set('cursor', cursor);
      const res = await api.get<{ items: ReportRow[]; nextCursor: string | null }>(
        `/admin/reconciliation/reports?${params.toString()}`,
      );
      if (cursor) {
        setReports((prev) => [...prev, ...res.items]);
      } else {
        setReports(res.items);
      }
      setNextCursor(res.nextCursor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = useCallback(async (id: string) => {
    setSelectedId(id);
    try {
      setDetail(await api.get<ReportDetail>(`/admin/reconciliation/reports/${id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load report.');
    }
  }, []);

  const trigger = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/reconciliation/trigger', {});
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Trigger failed.');
    } finally {
      setBusy(false);
    }
  }, [load]);

  const ack = useCallback(
    async (id: string) => {
      const notes = prompt('Notes (≥ 4 chars, or empty to skip)') ?? '';
      if (notes && notes.trim().length < 4) {
        setError('Notes too short — at least 4 chars.');
        return;
      }
      setBusy(true);
      try {
        await api.post(`/admin/reconciliation/discrepancies/${id}/ack`, {
          notes: notes.trim() || undefined,
        });
        if (selectedId) await open(selectedId);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Ack failed.');
      } finally {
        setBusy(false);
      }
    },
    [selectedId, open],
  );

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-brand-indigo-dark">Reconciliation</h1>
          <p className="mt-1 text-sm text-slate-600">
            Nightly compare of local CoinTransaction sums vs Bet wallet. Drift = local − remote.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void trigger()}
          className="rounded bg-brand-indigo px-3 py-2 text-sm font-medium text-white hover:bg-brand-indigo-dark disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Trigger now'}
        </button>
      </header>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Checked</th>
                <th className="px-3 py-2 text-left">Discrepant</th>
                <th className="px-3 py-2 text-left">|drift|</th>
              </tr>
            </thead>
            <tbody>
              {loading && reports.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>
              )}
              {!loading && reports.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">No reports yet — flip <code>reconciliation.enabled</code> or click "Trigger now".</td></tr>
              )}
              {reports.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => void open(r.id)}
                  className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${
                    selectedId === r.id ? 'bg-amber-50' : ''
                  }`}
                >
                  <td className="px-3 py-2 text-xs">{new Date(r.forDate).toISOString().slice(0, 10)}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.status === 'COMPLETED' ? (
                      <span className="text-emerald-700">Done</span>
                    ) : r.status === 'FAILED' ? (
                      <span className="text-red-700">Failed</span>
                    ) : (
                      <span className="text-amber-700">Running</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.usersChecked}</td>
                  <td className="px-3 py-2 text-xs">{r.usersDiscrepant}</td>
                  <td className="px-3 py-2 text-xs font-mono">{r.totalAbsDrift.toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor && (
            <div className="border-t border-slate-100 p-3 text-center">
              <button
                type="button"
                onClick={() => void load(nextCursor)}
                className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50"
              >Load more</button>
            </div>
          )}
        </div>

        <div className="rounded border border-slate-200 bg-white p-4">
          {!detail && <p className="text-sm text-slate-500">Pick a report.</p>}
          {detail && (
            <div className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-700">
                  {new Date(detail.forDate).toISOString().slice(0, 10)}
                </h2>
                <p className="text-xs text-slate-500">
                  Checked {detail.usersChecked} · OK {detail.usersOk} · Discrepant {detail.usersDiscrepant} · |drift| {detail.totalAbsDrift.toLocaleString('en-IN')}
                </p>
                {detail.failureReason && (
                  <p className="mt-1 text-xs text-red-700">Error: {detail.failureReason}</p>
                )}
              </div>

              <div className="max-h-96 overflow-y-auto rounded border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-2 py-1 text-left">User</th>
                      <th className="px-2 py-1 text-right">Local</th>
                      <th className="px-2 py-1 text-right">Remote</th>
                      <th className="px-2 py-1 text-right">Drift</th>
                      <th className="px-2 py-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.discrepancies.length === 0 && (
                      <tr><td colSpan={5} className="px-2 py-3 text-center text-slate-500">All books balanced 🎉</td></tr>
                    )}
                    {detail.discrepancies.map((d) => (
                      <tr key={d.id} className="border-t border-slate-100">
                        <td className="px-2 py-1 font-mono">{d.userId.slice(0, 8)}…</td>
                        <td className="px-2 py-1 text-right font-mono">{d.localSum.toLocaleString('en-IN')}</td>
                        <td className="px-2 py-1 text-right font-mono">{d.remoteSum.toLocaleString('en-IN')}</td>
                        <td className={`px-2 py-1 text-right font-mono ${d.drift > 0 ? 'text-red-700' : d.drift < 0 ? 'text-amber-700' : 'text-slate-500'}`}>
                          {d.drift.toLocaleString('en-IN')}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {d.acknowledged ? (
                            <span className="text-emerald-700">✓ acked</span>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void ack(d.id)}
                              className="rounded border border-slate-300 px-2 py-0.5 text-[10px] hover:bg-slate-50"
                            >Ack</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
