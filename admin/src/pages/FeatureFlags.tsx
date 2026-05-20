import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';

/**
 * Admin Feature Flags page — list + inline editor for every
 * `FeatureFlag` row. Backed by `GET/PATCH /admin/feature-flags`.
 *
 *   - BOOLEAN flags expose a single ON/OFF toggle (the most common
 *     case — kill switches, master enables).
 *   - ROLE flags surface a role multi-select.
 *   - PERCENT flags surface a slider + numeric input for 0..100.
 *
 * Mode changes are explicit (a separate dropdown). Switching mode
 * doesn't drop the other fields — leaving `roles` populated when
 * flipping from ROLE → PERCENT means the operator can flip back
 * without re-entering.
 *
 * Every save writes an `AdminAuditLog` entry server-side. Errors
 * surface inline; no toast / no auto-dismiss.
 */

type FlagMode = 'BOOLEAN' | 'ROLE' | 'PERCENT';
type Role = 'ADMIN' | 'MODERATOR' | 'FINANCE' | 'SUPPORT' | 'AUDITOR';

interface FlagRow {
  id: string;
  description: string;
  mode: FlagMode;
  enabled: boolean;
  roles: Role[];
  rolloutPercent: number;
  updatedBy: string | null;
  updatedAt: string;
  group: string;
}

interface ListResponse {
  items: FlagRow[];
  roles: Role[];
  modes: FlagMode[];
}

const GROUP_LABELS: Record<string, string> = {
  notifications: 'Notifications',
  outbox: 'Outbox',
  watchlist: 'Watchlist',
  aviator: 'Aviator',
  auctions: 'Auctions',
  kyc: 'KYC',
  rg: 'Responsible gambling',
};

export default function FeatureFlags() {
  const [rows, setRows] = useState<FlagRow[]>([]);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.get<ListResponse>('/admin/feature-flags');
      setRows(res.items);
      setAllRoles(res.roles);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'failed to load flags');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const grouped = useMemo(() => {
    const m = new Map<string, FlagRow[]>();
    for (const r of rows) {
      if (!m.has(r.group)) m.set(r.group, []);
      m.get(r.group)!.push(r);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-indigo-dark">
          Feature flags
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Toggle the gates that wrap every new product feature.
          Boolean flags are kill switches; ROLE / PERCENT flags
          drive gradual rollouts. Changes are audited.
        </p>
      </header>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {busy && rows.length === 0 ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
          No feature flags seeded yet. They land via per-feature
          migrations (see <code>notifications.enabled</code>,{' '}
          <code>outbox.enabled</code>, etc.).
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(([group, flags]) => (
            <section key={group}>
              <h2 className="mb-3 text-xs uppercase tracking-widest text-slate-500">
                {GROUP_LABELS[group] ?? group}
              </h2>
              <div className="space-y-3">
                {flags.map((f) => (
                  <FlagCard
                    key={f.id}
                    flag={f}
                    allRoles={allRoles}
                    onSaved={(updated) =>
                      setRows((prev) =>
                        prev.map((r) => (r.id === updated.id ? updated : r)),
                      )
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function FlagCard({
  flag,
  allRoles,
  onSaved,
}: {
  flag: FlagRow;
  allRoles: Role[];
  onSaved: (next: FlagRow) => void;
}) {
  const [draft, setDraft] = useState<FlagRow>(flag);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = useMemo(
    () =>
      draft.mode !== flag.mode ||
      draft.enabled !== flag.enabled ||
      draft.rolloutPercent !== flag.rolloutPercent ||
      JSON.stringify([...draft.roles].sort()) !==
        JSON.stringify([...flag.roles].sort()),
    [draft, flag],
  );

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const next = await api.patch<FlagRow>(
        `/admin/feature-flags/${encodeURIComponent(flag.id)}`,
        {
          mode: draft.mode,
          enabled: draft.enabled,
          roles: draft.roles,
          rolloutPercent: draft.rolloutPercent,
        },
      );
      onSaved({ ...next, group: flag.group });
      setDraft({ ...next, group: flag.group });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'save failed');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setDraft(flag);
    setError(null);
  }

  return (
    <div className="rounded border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <code className="text-sm font-mono text-brand-indigo-dark break-all">
            {flag.id}
          </code>
          <p className="mt-1 text-sm text-slate-600">{flag.description}</p>
          <div className="mt-1 text-xs text-slate-400">
            Last changed by {flag.updatedBy ?? 'system'}{' '}
            on {new Date(flag.updatedAt).toLocaleString()}
          </div>
        </div>
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-[10px] uppercase tracking-wider ${
            evaluateBadge(flag)
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-slate-200 text-slate-700'
          }`}
        >
          {evaluateBadge(flag) ? 'On' : 'Off'}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wider text-slate-500">
            Mode
          </label>
          <select
            value={draft.mode}
            onChange={(e) =>
              setDraft((d) => ({ ...d, mode: e.target.value as FlagMode }))
            }
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-indigo focus:outline-none"
          >
            <option value="BOOLEAN">BOOLEAN</option>
            <option value="ROLE">ROLE</option>
            <option value="PERCENT">PERCENT</option>
          </select>
        </div>

        {draft.mode === 'BOOLEAN' && (
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-slate-500">
              Enabled
            </label>
            <select
              value={draft.enabled ? 'true' : 'false'}
              onChange={(e) =>
                setDraft((d) => ({ ...d, enabled: e.target.value === 'true' }))
              }
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-indigo focus:outline-none"
            >
              <option value="true">On</option>
              <option value="false">Off</option>
            </select>
          </div>
        )}

        {draft.mode === 'ROLE' && (
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs uppercase tracking-wider text-slate-500">
              Roles (any-of)
            </label>
            <div className="flex flex-wrap gap-2">
              {allRoles.map((r) => {
                const on = draft.roles.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        roles: on
                          ? d.roles.filter((x) => x !== r)
                          : [...d.roles, r],
                      }))
                    }
                    className={`rounded border px-3 py-1 text-xs transition ${
                      on
                        ? 'border-brand-indigo bg-brand-indigo text-white'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {draft.mode === 'PERCENT' && (
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs uppercase tracking-wider text-slate-500">
              Rollout percent
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                value={draft.rolloutPercent}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    rolloutPercent: Number(e.target.value),
                  }))
                }
                className="flex-1"
              />
              <input
                type="number"
                min={0}
                max={100}
                value={draft.rolloutPercent}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    rolloutPercent: clamp(Number(e.target.value)),
                  }))
                }
                className="w-20 rounded border border-slate-300 px-2 py-1 text-sm focus:border-brand-indigo focus:outline-none"
              />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={reset}
          disabled={!dirty || busy}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || busy}
          className="rounded bg-brand-indigo px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-indigo-dark disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function evaluateBadge(flag: FlagRow): boolean {
  // Display-only — the actual user-facing decision uses the
  // service. For the badge we surface "would-this-affect-someone":
  // BOOLEAN reads `enabled`, ROLE requires non-empty roles,
  // PERCENT requires rolloutPercent > 0.
  if (flag.mode === 'BOOLEAN') return flag.enabled;
  if (flag.mode === 'ROLE') return flag.roles.length > 0;
  return flag.rolloutPercent > 0;
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
