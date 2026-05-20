import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';

/**
 * Admin fraud review queue (PR-FRAUD-2).
 *
 * Builds on PR-FRAUD-1's signal table with three new affordances:
 *
 *   1. **Bulk select + bulk ack** — a checkbox column lets the admin
 *      tick many LOW-severity signals at once and resolve them with
 *      a single batch note. The /admin/fraud/signals/bulk-review
 *      endpoint enforces a 100-row cap.
 *   2. **Ban cluster** — when a CLUSTER_* signal is opened, the
 *      "Ban affected users" action calls
 *      /admin/fraud/signals/:id/ban-cluster. Refused on velocity
 *      signals (they go through the regular user-detail ban path).
 *   3. **Unban** — for false-positive recovery. The userId is taken
 *      from the signal's affectedUserIds list and we show one
 *      button per affected user once they're banned.
 *
 * Severity sort: backend already returns rows ordered by reviewed,
 * severity desc, createdAt desc — so HIGH unreviewed signals
 * surface first. We surface that via row tinting (red border for
 * HIGH, amber for MEDIUM).
 */

type Severity = 'LOW' | 'MEDIUM' | 'HIGH';
type SignalKind = 'VELOCITY_BID' | 'VELOCITY_LOGIN' | 'VELOCITY_WITHDRAWAL' | 'CLUSTER_IP' | 'CLUSTER_DEVICE' | 'CLUSTER_REFERRAL';

interface SignalRow {
  id: string;
  kind: SignalKind;
  severity: Severity;
  userId: string | null;
  clusterKey: string | null;
  affectedUserIds: string[] | null;
  metadata: Record<string, unknown>;
  reviewed: boolean;
  reviewedBy: string | null;
  reviewedAt: string | null;
  notes: string | null;
  createdAt: string;
}

const SEVERITY_TONE: Record<Severity, string> = {
  HIGH:   'border-red-300 bg-red-50',
  MEDIUM: 'border-amber-300 bg-amber-50',
  LOW:    'border-slate-200 bg-white',
};

const KIND_LABEL: Record<SignalKind, string> = {
  VELOCITY_BID:        'Bid velocity',
  VELOCITY_LOGIN:      'Login velocity',
  VELOCITY_WITHDRAWAL: 'Withdrawal velocity',
  CLUSTER_IP:          'IP cluster',
  CLUSTER_DEVICE:      'Device cluster',
  CLUSTER_REFERRAL:    'Referral velocity',
};

export default function Fraud() {
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<'unreviewed' | 'reviewed' | 'all'>('unreviewed');
  const [severity, setSeverity] = useState<Severity | ''>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<SignalRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const isCluster = useMemo(
    () => detail !== null && detail.userId === null && detail.affectedUserIds !== null,
    [detail],
  );

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (reviewed === 'unreviewed') params.set('reviewed', 'false');
        if (reviewed === 'reviewed') params.set('reviewed', 'true');
        if (severity) params.set('severity', severity);
        if (cursor) params.set('cursor', cursor);
        const res = await api.get<{ items: SignalRow[]; nextCursor: string | null }>(
          `/admin/fraud/signals?${params.toString()}`,
        );
        if (cursor) {
          setSignals((prev) => [...prev, ...res.items]);
        } else {
          setSignals(res.items);
          // Clearing the filter resets selection too — the IDs we had
          // selected might not even be in the new view.
          setSelected(new Set());
        }
        setNextCursor(res.nextCursor);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Failed to load.');
      } finally {
        setLoading(false);
      }
    },
    [reviewed, severity],
  );

  useEffect(() => { void load(); }, [load]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectVisibleUnreviewed = useCallback(() => {
    setSelected(new Set(signals.filter((s) => !s.reviewed).map((s) => s.id)));
  }, [signals]);

  const bulkReview = useCallback(async () => {
    if (selected.size === 0) return;
    const note = prompt('Batch note (≥ 4 chars, or empty to skip)') ?? '';
    if (note && note.trim().length < 4) {
      setError('Batch note too short — at least 4 chars.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/fraud/signals/bulk-review', {
        signalIds: Array.from(selected),
        batchNote: note.trim() || undefined,
      });
      setSelected(new Set());
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Bulk review failed.');
    } finally {
      setBusy(false);
    }
  }, [selected, load]);

  const banCluster = useCallback(async () => {
    if (!detail) return;
    const reason = prompt('Ban reason (≥ 10 chars)') ?? '';
    if (reason.trim().length < 10) {
      setError('Ban reason too short — at least 10 chars.');
      return;
    }
    if (!confirm(`Ban ${detail.affectedUserIds?.length ?? 0} users? This is reversible via individual unban.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ bannedUserIds: string[]; alreadyBanned: string[] }>(
        `/admin/fraud/signals/${detail.id}/ban-cluster`,
        { reason: reason.trim() },
      );
      alert(`Banned ${res.bannedUserIds.length} (already banned: ${res.alreadyBanned.length}).`);
      await load();
      setDetail(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ban failed.');
    } finally {
      setBusy(false);
    }
  }, [detail, load]);

  const unbanOne = useCallback(async (userId: string) => {
    const reason = prompt(`Unban ${userId} — reason (≥ 4 chars)`) ?? '';
    if (reason.trim().length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ wasBanned: boolean }>(
        `/admin/fraud/users/${userId}/unban`,
        { reason: reason.trim() },
      );
      alert(res.wasBanned ? 'Unbanned.' : 'User was not banned (no-op).');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Unban failed.');
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-indigo-dark">Fraud signals</h1>
        <p className="mt-1 text-sm text-slate-600">
          Bulk-ack noise · ban clear-fraud clusters · unban false positives.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Show</span>
          <select
            value={reviewed}
            onChange={(e) => setReviewed(e.target.value as 'unreviewed' | 'reviewed' | 'all')}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="unreviewed">Unreviewed only</option>
            <option value="reviewed">Reviewed only</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Severity</span>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as Severity | '')}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="">Any</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={selectVisibleUnreviewed}
            className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50"
          >
            Select all unreviewed
          </button>
          <button
            type="button"
            disabled={busy || selected.size === 0}
            onClick={() => void bulkReview()}
            className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Bulk review ({selected.size})
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* List */}
        <div className="rounded border border-slate-200 bg-white">
          {loading && signals.length === 0 && (
            <div className="px-3 py-6 text-center text-slate-500">Loading…</div>
          )}
          {!loading && signals.length === 0 && (
            <div className="px-3 py-6 text-center text-slate-500">All clear 🎉</div>
          )}
          <ul className="divide-y divide-slate-100">
            {signals.map((s) => (
              <li
                key={s.id}
                className={`flex items-center gap-3 border-l-4 px-3 py-2 ${SEVERITY_TONE[s.severity]} ${
                  detail?.id === s.id ? 'ring-2 ring-amber-300' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={() => toggleSelect(s.id)}
                  disabled={s.reviewed}
                />
                <button
                  type="button"
                  onClick={() => setDetail(s)}
                  className="flex-1 cursor-pointer text-left text-sm"
                >
                  <div className="font-medium">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">{s.severity}</span>{' '}
                    {KIND_LABEL[s.kind]}
                    {s.reviewed && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800">reviewed</span>}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {s.userId ? `user ${s.userId.slice(0, 8)}…` : `cluster ${s.clusterKey?.slice(0, 20) ?? ''} · ${s.affectedUserIds?.length ?? 0} users`}
                    {' · '}
                    {new Date(s.createdAt).toLocaleString()}
                  </div>
                </button>
              </li>
            ))}
          </ul>
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

        {/* Detail */}
        <div className="rounded border border-slate-200 bg-white p-4">
          {!detail && <p className="text-sm text-slate-500">Pick a signal.</p>}
          {detail && (
            <div className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-700">
                  {KIND_LABEL[detail.kind]} · {detail.severity}
                </h2>
                <p className="text-[11px] text-slate-500">
                  {new Date(detail.createdAt).toLocaleString()}
                  {detail.reviewed && detail.reviewedAt && (
                    <> · reviewed {new Date(detail.reviewedAt).toLocaleString()} by {detail.reviewedBy}</>
                  )}
                </p>
              </div>

              <div className="rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                <pre className="overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(detail.metadata, null, 2)}</pre>
              </div>

              {detail.notes && (
                <div className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-900">
                  Notes: {detail.notes}
                </div>
              )}

              {isCluster && detail.affectedUserIds && (
                <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-wider text-slate-500">
                    Affected users ({detail.affectedUserIds.length})
                  </div>
                  <ul className="max-h-40 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                    {detail.affectedUserIds.map((uid) => (
                      <li key={uid} className="flex items-center justify-between py-0.5">
                        <span className="font-mono">{uid}</span>
                        <button
                          type="button"
                          onClick={() => void unbanOne(uid)}
                          disabled={busy}
                          className="text-[10px] text-slate-500 hover:underline disabled:opacity-50"
                        >Unban</button>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={busy || detail.reviewed}
                    onClick={() => void banCluster()}
                    className="rounded bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    Ban all {detail.affectedUserIds.length} users
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
