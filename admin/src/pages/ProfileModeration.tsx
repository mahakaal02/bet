import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

/**
 * Admin profile-moderation queue (PR-PROFILE-2).
 *
 *   1. List flagged display-name changes (default reviewAction=PENDING).
 *   2. Click a row to see the before/after and the flagReason.
 *   3. Decide: keep-as-is OR force-rename to a moderator-supplied
 *      value (validated server-side against the same display-name
 *      rules as user-side renames).
 *
 * The queue is intentionally LATEST-FIRST — the most recent flags
 * usually matter most (e.g. a brand-new user impersonating support).
 * Older items drift down and can be cleaned up in batches.
 */

type ReviewAction = 'PENDING' | 'KEPT_AS_IS' | 'FORCED_RENAME' | 'NONE';

interface QueueRow {
  historyId: string;
  userId: string;
  username: string;
  email: string | null;
  currentDisplayName: string | null;
  field: string;
  before: string | null;
  after: string | null;
  flagReason: string | null;
  reviewAction: ReviewAction;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNotes: string | null;
  changedAt: string;
}

interface ListResponse {
  items: QueueRow[];
  nextCursor: string | null;
}

export default function ProfileModeration() {
  const [items, setItems] = useState<QueueRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [action, setAction] = useState<ReviewAction>('PENDING');
  const [selected, setSelected] = useState<QueueRow | null>(null);
  const [newName, setNewName] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set('action', action);
        if (cursor) params.set('cursor', cursor);
        const res = await api.get<ListResponse>(`/admin/profile/queue?${params.toString()}`);
        if (cursor) {
          setItems((prev) => [...prev, ...res.items]);
        } else {
          setItems(res.items);
        }
        setNextCursor(res.nextCursor);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Failed to load queue.');
      } finally {
        setLoading(false);
      }
    },
    [action],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const keepAsIs = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/profile/${selected.historyId}/keep`, {
        notes: notes.trim() || undefined,
      });
      setItems((prev) => prev.filter((r) => r.historyId !== selected.historyId));
      setSelected(null);
      setNotes('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Decision failed.');
    } finally {
      setBusy(false);
    }
  }, [selected, notes]);

  const forceRename = useCallback(async () => {
    if (!selected) return;
    if (newName.trim().length < 3) {
      setError('New display name must be at least 3 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/profile/${selected.historyId}/rename`, {
        newDisplayName: newName.trim(),
        notes: notes.trim() || undefined,
      });
      setItems((prev) => prev.filter((r) => r.historyId !== selected.historyId));
      setSelected(null);
      setNewName('');
      setNotes('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Rename failed.');
    } finally {
      setBusy(false);
    }
  }, [selected, newName, notes]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-indigo-dark">
          Profile moderation
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Flagged display-name changes. Decide each one: keep as-is, or
          force-rename to something clearly safe.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Action filter</span>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value as ReviewAction)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="PENDING">Pending</option>
            <option value="KEPT_AS_IS">Kept as-is</option>
            <option value="FORCED_RENAME">Force-renamed</option>
            <option value="NONE">All (unflagged)</option>
          </select>
        </label>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Changed</th>
                <th className="px-3 py-2 text-left">User</th>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Flag</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                    Nothing matches.
                  </td>
                </tr>
              )}
              {items.map((row) => (
                <tr
                  key={row.historyId}
                  onClick={() => setSelected(row)}
                  className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${
                    selected?.historyId === row.historyId ? 'bg-amber-50' : ''
                  }`}
                >
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {new Date(row.changedAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    @{row.username}
                    {row.email && <div className="text-[11px] text-slate-500">{row.email}</div>}
                  </td>
                  <td className="px-3 py-2">{row.after ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-amber-800">{row.flagReason ?? '—'}</td>
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
              >
                Load more
              </button>
            </div>
          )}
        </div>

        <div className="rounded border border-slate-200 bg-white p-4">
          {!selected && <p className="text-sm text-slate-500">Pick a row to decide.</p>}
          {selected && (
            <div className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-700">
                  @{selected.username}
                </h2>
                <p className="text-xs text-slate-500">{selected.email ?? 'no email'}</p>
              </div>

              <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
                <div>
                  <span className="text-xs text-slate-500">Before:</span>{' '}
                  <span className="font-mono">{selected.before ?? '—'}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500">After:</span>{' '}
                  <span className="font-mono">{selected.after ?? '—'}</span>
                </div>
                <div className="mt-1 text-xs text-amber-800">
                  Flag reason: {selected.flagReason ?? '—'}
                </div>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">Notes (optional)</span>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={500}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void keepAsIs()}
                  className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Keep as-is
                </button>
              </div>

              <div className="space-y-2 rounded border border-amber-300 bg-amber-50/40 p-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-amber-800">Force-rename to:</span>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    maxLength={40}
                    placeholder="New display name"
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || newName.trim().length < 3}
                  onClick={() => void forceRename()}
                  className="rounded bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  Force rename
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
