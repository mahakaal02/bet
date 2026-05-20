import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

/**
 * Admin impersonation page. Two halves:
 *
 *   1. Start panel — user search (reuses the /admin/roles/users
 *      endpoint from PR-RBAC-1 #33 for autocomplete) + reason
 *      field. On submit, the backend issues a 1-hour JWT for the
 *      target user; we surface it as a copy-to-clipboard token
 *      with a "Open auctions as this user" link.
 *   2. Log panel — paginated history of past impersonations,
 *      with admin/user/reason/duration columns. The admin who
 *      opened the page sees their OWN log by default; a search
 *      box lets auditors filter by adminId or userId.
 *
 * No auto-redirect on start — the admin gets a token they can
 * paste into a fresh browser session manually. Auto-redirect with
 * cookie-swapping is the PR-IMPERSONATE-2 follow-up (it needs the
 * auctions app to know about the impersonation banner first).
 */

type Mode = 'start' | 'log';

interface UserHit {
  id: string;
  email: string | null;
  username: string;
  displayName: string | null;
  isAdmin: boolean;
}

interface LogRow {
  id: string;
  adminId: string;
  adminUsername: string;
  adminEmail: string | null;
  userId: string;
  userUsername: string;
  startedAt: string;
  endedAt: string | null;
  reason: string;
  durationMs: number;
}

interface StartResponse {
  token: string;
  expiresIn: string;
  impersonationId: string;
  user: { id: string; email: string | null; username: string; displayName: string | null };
}

export default function Impersonate() {
  const [mode, setMode] = useState<Mode>('start');

  // Start-panel state.
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<UserHit[]>([]);
  const [selected, setSelected] = useState<UserHit | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<StartResponse | null>(null);

  // Log state.
  const [logRows, setLogRows] = useState<LogRow[]>([]);
  const [filterMe, setFilterMe] = useState(true);

  useEffect(() => {
    if (mode === 'log') void loadLog();
  }, [mode, filterMe]);

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const res = await api.get<{ items: UserHit[] }>(
          `/admin/roles/users?q=${encodeURIComponent(term)}`,
        );
        setHits(res.items);
      } catch {
        setHits([]);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [search]);

  async function start() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setMinted(null);
    try {
      const res = await api.post<StartResponse>('/admin/impersonate', {
        userId: selected.id,
        reason: reason.trim(),
      });
      setMinted(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to start.');
    } finally {
      setBusy(false);
    }
  }

  async function endSession(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/impersonate/${id}/end`, {});
      setMinted(null);
      if (mode === 'log') await loadLog();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to end.');
    } finally {
      setBusy(false);
    }
  }

  async function loadLog() {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterMe) {
        const me = await api.get<{ id: string }>('/auth/me');
        params.set('adminId', me.id);
      }
      const res = await api.get<{ items: LogRow[] }>(
        `/admin/impersonate?${params.toString()}`,
      );
      setLogRows(res.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load log.');
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-indigo-dark">
          Impersonation
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Act as another user for support investigation. Every action
          is captured in the impersonation log and the admin audit
          trail.
        </p>
      </header>

      <nav className="flex gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setMode('start')}
          className={`px-3 py-1.5 rounded text-sm transition ${
            mode === 'start' ? 'bg-brand-indigo text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          Start session
        </button>
        <button
          type="button"
          onClick={() => setMode('log')}
          className={`px-3 py-1.5 rounded text-sm transition ${
            mode === 'log' ? 'bg-brand-indigo text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          History log
        </button>
      </nav>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {mode === 'start' && (
        <div className="space-y-4">
          <div className="rounded border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">
              Find a user
            </h2>
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSelected(null);
              }}
              placeholder="Search by email, username, or display name…"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-indigo focus:outline-none"
            />
            {hits.length > 0 && !selected && (
              <ul className="mt-2 max-h-64 overflow-y-auto rounded border border-slate-200">
                {hits.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(u);
                        setSearch(u.email ?? u.username);
                        setHits([]);
                      }}
                      disabled={u.isAdmin}
                      className={`block w-full px-3 py-2 text-left text-sm ${
                        u.isAdmin
                          ? 'cursor-not-allowed bg-slate-50 text-slate-400'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <span className="block font-medium">
                        @{u.username}
                        {u.isAdmin && (
                          <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-700">
                            admin (cannot impersonate)
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {u.email ?? 'no email'}
                        {u.displayName ? ` · ${u.displayName}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selected && (
            <div className="rounded border border-slate-200 bg-white p-4 space-y-3">
              <p className="text-sm text-slate-700">
                You will act as{' '}
                <strong>@{selected.username}</strong> ({selected.email ?? 'no email'}).
              </p>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">
                  Reason (10+ chars, captured in audit log)
                </span>
                <textarea
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  placeholder="e.g. ticket #1234, user reports stuck withdrawal — confirming wallet state"
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-indigo focus:outline-none"
                />
              </label>
              <button
                type="button"
                onClick={start}
                disabled={busy || reason.trim().length < 10}
                className="rounded bg-brand-indigo px-4 py-2 text-sm font-medium text-white hover:bg-brand-indigo-dark disabled:opacity-50"
              >
                {busy ? 'Starting…' : 'Start impersonation'}
              </button>
            </div>
          )}

          {minted && (
            <div className="rounded border border-emerald-200 bg-emerald-50 p-4 space-y-3">
              <p className="text-sm font-semibold text-emerald-900">
                Impersonation token issued — expires in {minted.expiresIn}
              </p>
              <p className="text-xs text-slate-700">
                Use this JWT in place of your admin session. Paste it into the
                browser&apos;s session token cookie for the auctions app, or
                set it as the Authorization header for API calls.
              </p>
              <code className="block break-all rounded bg-slate-900 px-3 py-2 font-mono text-[11px] text-emerald-200">
                {minted.token}
              </code>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(minted.token)}
                  className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-white"
                >
                  Copy token
                </button>
                <button
                  type="button"
                  onClick={() => endSession(minted.impersonationId)}
                  className="rounded border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-700 hover:bg-red-100"
                >
                  End session now
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {mode === 'log' && (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={filterMe}
              onChange={(e) => setFilterMe(e.target.checked)}
            />
            Show only my impersonations
          </label>

          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Started</th>
                  <th className="px-3 py-2 text-left">Admin</th>
                  <th className="px-3 py-2 text-left">User</th>
                  <th className="px-3 py-2 text-left">Reason</th>
                  <th className="px-3 py-2 text-left">Duration</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {logRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                      No impersonations yet.
                    </td>
                  </tr>
                ) : (
                  logRows.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {new Date(r.startedAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">@{r.adminUsername}</td>
                      <td className="px-3 py-2">@{r.userUsername}</td>
                      <td className="px-3 py-2 max-w-md truncate">{r.reason}</td>
                      <td className="px-3 py-2 text-xs">
                        {humanDuration(r.durationMs)}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {r.endedAt ? (
                          <span className="text-slate-500">Ended</span>
                        ) : (
                          <span className="text-emerald-700">Active</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function humanDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}
