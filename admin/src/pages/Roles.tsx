import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

/**
 * Admin role-management page. Three panels:
 *
 *   1. Search bar — looks up users by email / username /
 *      displayName. Debounced 250ms, surfaces up to 20 hits.
 *   2. Detail card — selected user's identity + active + revoked
 *      role grants, in granted-at-desc order.
 *   3. Grant/revoke row — pick a role, click to grant. Active
 *      roles show a revoke button.
 *
 * Every grant + revoke is audited by the backend
 * (`AuditLogService`). A successful action reloads the detail
 * view so the audit-history table in the slide-out stays fresh.
 *
 * Hardening:
 *   - "Revoke ADMIN" is disabled on the current user's own row
 *     (server enforces too, but the disabled affordance is
 *     friendlier).
 *   - Action buttons disable during in-flight to prevent double-
 *     grant on a slow network.
 *   - Errors render inline with an explicit dismiss; no toast,
 *     no auto-disappear (administrative actions warrant
 *     acknowledged failure).
 */

type Role = 'ADMIN' | 'MODERATOR' | 'FINANCE' | 'SUPPORT' | 'AUDITOR';

interface UserSearchResult {
  id: string;
  email: string | null;
  username: string;
  displayName: string | null;
  isAdmin: boolean;
  bannedAt: string | null;
  createdAt: string;
}

interface Grant {
  role: Role;
  grantedBy: string | null;
  grantedAt: string;
  revokedAt: string | null;
  active: boolean;
}

interface UserDetail extends UserSearchResult {
  bannedReason: string | null;
  bannedBy: string | null;
  grants: Grant[];
}

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: 'Full god-mode. Can create other admins, edit schema, change billing.',
  MODERATOR: 'User CRUD, ban/unban, content moderation, read-only ledger.',
  FINANCE: 'Withdrawal approval, reconciliation, ledger exports.',
  SUPPORT: 'Ticket access, read-only user data.',
  AUDITOR: 'Read-only access to audit log + all data. No writes.',
};

export default function Roles() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [actionRole, setActionRole] = useState<Role>('MODERATOR');
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentAdminId, setCurrentAdminId] = useState<string | null>(null);

  // Load enums + current admin once.
  useEffect(() => {
    void (async () => {
      try {
        const [roles, me] = await Promise.all([
          api.get<{ roles: Role[] }>('/admin/roles'),
          api.get<{ id: string }>('/auth/me'),
        ]);
        setAllRoles(roles.roles);
        setCurrentAdminId(me.id);
      } catch {
        // Non-fatal — the page still works without these.
      }
    })();
  }, []);

  // Debounced search.
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    if (query.trim().length < 2) return;
    const handle = setTimeout(() => {
      void runSearch(query);
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  async function runSearch(q: string) {
    setSearchBusy(true);
    setError(null);
    try {
      const res = await api.get<{ items: UserSearchResult[] }>(
        `/admin/roles/users?q=${encodeURIComponent(q)}`,
      );
      setResults(res.items);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
    } finally {
      setSearchBusy(false);
    }
  }

  async function loadDetail(id: string) {
    setDetailBusy(true);
    setError(null);
    setSelectedId(id);
    try {
      const d = await api.get<UserDetail>(`/admin/roles/users/${id}`);
      setDetail(d);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
    } finally {
      setDetailBusy(false);
    }
  }

  async function grant(role: Role) {
    if (!selectedId) return;
    setActionBusy(true);
    setError(null);
    try {
      await api.post(`/admin/roles/users/${selectedId}/grant`, { role });
      await loadDetail(selectedId);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
    } finally {
      setActionBusy(false);
    }
  }

  async function revoke(role: Role) {
    if (!selectedId) return;
    if (!confirm(`Revoke ${role} from ${detail?.username}?`)) return;
    setActionBusy(true);
    setError(null);
    try {
      await api.post(`/admin/roles/users/${selectedId}/revoke`, { role });
      await loadDetail(selectedId);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
    } finally {
      setActionBusy(false);
    }
  }

  const activeRoles = new Set(
    (detail?.grants ?? []).filter((g) => g.active).map((g) => g.role),
  );

  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Roles &amp; permissions</h1>
        <p className="mt-1 text-sm text-slate-500">
          Grant or revoke operator roles. Every change is recorded in the
          audit log.
        </p>
      </header>

      {error && (
        <div className="mb-4 flex items-start justify-between rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss"
            className="ml-2 text-lg leading-none"
          >
            ×
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Find user
            </span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="email, username, or display name"
              className="w-full rounded border-slate-300 px-3 py-2 text-sm"
              autoFocus
            />
          </label>

          <div className="mt-3">
            {searchBusy && query.length >= 2 && (
              <p className="text-xs text-slate-400">Searching…</p>
            )}
            {!searchBusy && results.length === 0 && query.length >= 2 && (
              <p className="text-xs text-slate-400">No matches.</p>
            )}
            {results.length > 0 && (
              <ul className="divide-y divide-slate-100">
                {results.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => void loadDetail(u.id)}
                      className={`flex w-full items-center justify-between px-2 py-2 text-left text-sm hover:bg-slate-50 ${
                        selectedId === u.id ? 'bg-indigo-50' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-slate-800">
                            {u.username}
                          </span>
                          {u.isAdmin && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                              admin
                            </span>
                          )}
                          {u.bannedAt && (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-800">
                              banned
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs text-slate-500">
                          {u.email ?? '(no email)'}
                        </div>
                      </div>
                      <span className="ml-3 text-[10px] font-mono text-slate-400">
                        {u.id.slice(0, 8)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          {!detail ? (
            <p className="text-center text-sm text-slate-400">
              Select a user from the search results to view + edit roles.
            </p>
          ) : (
            <>
              <header className="mb-3 border-b border-slate-100 pb-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-lg font-semibold text-slate-800">
                    {detail.username}
                  </h2>
                  <code className="text-[10px] font-mono text-slate-400">
                    {detail.id}
                  </code>
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  {detail.email ?? '(no email)'}
                  {detail.displayName && (
                    <span className="ml-2 text-slate-400">
                      · "{detail.displayName}"
                    </span>
                  )}
                </div>
                {detail.bannedAt && (
                  <div className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
                    Banned {new Date(detail.bannedAt).toLocaleString()} — {' '}
                    {detail.bannedReason ?? 'no reason'}
                  </div>
                )}
                <p className="mt-2 text-[10px] text-slate-400">
                  Joined {new Date(detail.createdAt).toLocaleDateString()}
                </p>
              </header>

              <div className="mb-3">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Active roles
                </span>
                <ActiveRolesPanel
                  detail={detail}
                  activeRoles={activeRoles}
                  currentAdminId={currentAdminId}
                  actionBusy={actionBusy}
                  onRevoke={revoke}
                />
              </div>

              <div className="rounded border border-dashed border-slate-300 p-3">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Grant a new role
                </span>
                <div className="flex items-center gap-2">
                  <select
                    value={actionRole}
                    onChange={(e) => setActionRole(e.target.value as Role)}
                    className="flex-1 rounded border-slate-300 px-2 py-1.5 text-sm"
                  >
                    {allRoles.map((r) => (
                      <option key={r} value={r} disabled={activeRoles.has(r)}>
                        {r}
                        {activeRoles.has(r) ? ' (already held)' : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void grant(actionRole)}
                    disabled={actionBusy || activeRoles.has(actionRole)}
                    className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {actionBusy ? '…' : 'Grant'}
                  </button>
                </div>
                <p className="mt-2 text-[11px] leading-snug text-slate-500">
                  {ROLE_DESCRIPTIONS[actionRole]}
                </p>
              </div>

              {detailBusy && (
                <p className="mt-3 text-xs text-slate-400">Loading…</p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function ActiveRolesPanel({
  detail,
  activeRoles,
  currentAdminId,
  actionBusy,
  onRevoke,
}: {
  detail: UserDetail;
  activeRoles: Set<Role>;
  currentAdminId: string | null;
  actionBusy: boolean;
  onRevoke: (role: Role) => void;
}) {
  const selfAdmin = detail.id === currentAdminId;
  if (activeRoles.size === 0 && !detail.isAdmin) {
    return (
      <p className="text-xs text-slate-400">No roles granted.</p>
    );
  }
  return (
    <ul className="space-y-2">
      {detail.isAdmin && !activeRoles.has('ADMIN') && (
        <li className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Legacy <code>isAdmin</code> flag is set. Grant ADMIN to migrate
          to the new role table; the legacy flag stays as a backstop.
        </li>
      )}
      {[...activeRoles].map((role) => {
        const grant = detail.grants.find((g) => g.role === role && g.active);
        const disableRevoke = selfAdmin && role === 'ADMIN';
        return (
          <li
            key={role}
            className="flex items-center justify-between gap-2 rounded border border-slate-200 px-3 py-2 text-sm"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-700">{role}</span>
                {disableRevoke && (
                  <span className="text-[10px] text-slate-400">
                    (your own — ask another admin to revoke)
                  </span>
                )}
              </div>
              {grant && (
                <div className="text-[11px] text-slate-500">
                  Granted {new Date(grant.grantedAt).toLocaleString()}
                  {grant.grantedBy && (
                    <span>
                      {' '}
                      by <code className="font-mono">{grant.grantedBy.slice(0, 8)}</code>
                    </span>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => onRevoke(role)}
              disabled={actionBusy || disableRevoke}
              className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
            >
              Revoke
            </button>
          </li>
        );
      })}
    </ul>
  );
}
