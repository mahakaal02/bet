import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';

/**
 * Admin audit-log viewer. Reads from `GET /admin/audit` (with the
 * standard filter chips + cursor pagination). The intent is
 * forensic: an admin asking "who edited this auction yesterday"
 * gets an answer in two clicks.
 *
 * The page is intentionally read-only. The audit log is append-
 * only; there is no edit / delete affordance, by design. The
 * "View diff" affordance opens a side panel with the before/after
 * JSON for the selected row.
 */

interface AuditRow {
  id: string;
  actorId: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  correlationId: string | null;
  createdAt: string;
}

interface AuditListResponse {
  items: AuditRow[];
  nextCursor: string | null;
}

interface Filters {
  actor: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = {
  actor: '',
  actorEmail: '',
  action: '',
  targetType: '',
  targetId: '',
  from: '',
  to: '',
};

export default function AuditLog() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  // The applied filters are separate from the input state so the
  // user can edit several filter chips without re-fetching after
  // every keystroke.
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [actions, setActions] = useState<string[]>([]);
  const [targetTypes, setTargetTypes] = useState<string[]>([]);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // Initial enum loads — populates the action + targetType
  // dropdowns from what the audit log actually contains.
  useEffect(() => {
    void (async () => {
      try {
        const [a, t] = await Promise.all([
          api.get<string[]>('/admin/audit/actions'),
          api.get<string[]>('/admin/audit/target-types'),
        ]);
        setActions(a);
        setTargetTypes(t);
      } catch {
        // Non-fatal — the dropdowns just stay empty.
      }
    })();
  }, []);

  // Apply triggered list fetch. Resets the cursor.
  useEffect(() => {
    setRows([]);
    setCursor(null);
    void load(applied, null, true);
  }, [applied]);

  async function load(f: Filters, cur: string | null, replace: boolean) {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (f.actor) params.set('actor', f.actor);
      if (f.actorEmail) params.set('actorEmail', f.actorEmail);
      if (f.action) params.set('action', f.action);
      if (f.targetType) params.set('targetType', f.targetType);
      if (f.targetId) params.set('targetId', f.targetId);
      if (f.from) params.set('from', f.from);
      if (f.to) params.set('to', f.to);
      if (cur) params.set('cursor', cur);
      params.set('limit', '50');
      const res = await api.get<AuditListResponse>(
        `/admin/audit?${params.toString()}`,
      );
      setRows((prev) => (replace ? res.items : [...prev, ...res.items]));
      setCursor(res.nextCursor);
      setHasMore(!!res.nextCursor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load audit log.');
    } finally {
      setBusy(false);
    }
  }

  const selected = useMemo(
    () => rows.find((r) => r.id === openId) ?? null,
    [openId, rows],
  );

  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Admin audit log</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every state-mutating admin action is recorded here. The log is
          append-only — rows cannot be edited or deleted.
        </p>
      </header>

      <FilterBar
        filters={filters}
        actions={actions}
        targetTypes={targetTypes}
        onChange={setFilters}
        onApply={() => setApplied(filters)}
        onReset={() => {
          setFilters(EMPTY_FILTERS);
          setApplied(EMPTY_FILTERS);
        }}
      />

      {error && (
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">IP</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && !busy && (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center text-slate-400">
                  No audit entries match the current filters.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs text-slate-600">
                  {new Date(r.createdAt).toISOString().replace('T', ' ').slice(0, 19)}
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-800">{r.actorEmail}</div>
                  <div className="text-[10px] font-mono text-slate-400">{r.actorId.slice(0, 8)}</div>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-3 py-2">
                  <div className="text-slate-700">{r.targetType}</div>
                  <div className="text-[10px] font-mono text-slate-400">{r.targetId.slice(0, 12)}</div>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">
                  {r.ipAddress ?? '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setOpenId(r.id)}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    View diff →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {hasMore && (
          <div className="border-t border-slate-100 px-3 py-2 text-center">
            <button
              type="button"
              disabled={busy}
              onClick={() => void load(applied, cursor, false)}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
            >
              {busy ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>

      {selected && (
        <DiffPanel row={selected} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

function FilterBar({
  filters,
  actions,
  targetTypes,
  onChange,
  onApply,
  onReset,
}: {
  filters: Filters;
  actions: string[];
  targetTypes: string[];
  onChange: (f: Filters) => void;
  onApply: () => void;
  onReset: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-4">
        <FilterField label="Actor email">
          <input
            type="text"
            value={filters.actorEmail}
            onChange={(e) => onChange({ ...filters, actorEmail: e.target.value })}
            placeholder="admin@…"
            className="w-full rounded border-slate-300 px-2 py-1.5 text-sm"
          />
        </FilterField>
        <FilterField label="Actor ID">
          <input
            type="text"
            value={filters.actor}
            onChange={(e) => onChange({ ...filters, actor: e.target.value })}
            placeholder="user-cuid"
            className="w-full rounded border-slate-300 px-2 py-1.5 text-sm font-mono"
          />
        </FilterField>
        <FilterField label="Action">
          <select
            value={filters.action}
            onChange={(e) => onChange({ ...filters, action: e.target.value })}
            className="w-full rounded border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Any</option>
            {actions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Target type">
          <select
            value={filters.targetType}
            onChange={(e) => onChange({ ...filters, targetType: e.target.value })}
            className="w-full rounded border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Any</option>
            {targetTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Target ID">
          <input
            type="text"
            value={filters.targetId}
            onChange={(e) => onChange({ ...filters, targetId: e.target.value })}
            placeholder="auction-…"
            className="w-full rounded border-slate-300 px-2 py-1.5 text-sm font-mono"
          />
        </FilterField>
        <FilterField label="From">
          <input
            type="datetime-local"
            value={filters.from}
            onChange={(e) => onChange({ ...filters, from: e.target.value })}
            className="w-full rounded border-slate-300 px-2 py-1.5 text-sm"
          />
        </FilterField>
        <FilterField label="To">
          <input
            type="datetime-local"
            value={filters.to}
            onChange={(e) => onChange({ ...filters, to: e.target.value })}
            className="w-full rounded border-slate-300 px-2 py-1.5 text-sm"
          />
        </FilterField>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onApply}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Apply filters
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function DiffPanel({
  row,
  onClose,
}: {
  row: AuditRow;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-30 flex items-stretch justify-end bg-slate-900/40"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <div>
            <div className="text-xs font-mono text-slate-500">{row.id}</div>
            <h2 className="text-lg font-semibold text-slate-800">{row.action}</h2>
            <div className="text-xs text-slate-500">
              by <span className="font-medium">{row.actorEmail}</span> ·{' '}
              {new Date(row.createdAt).toLocaleString()}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-2xl text-slate-400 hover:text-slate-600"
          >
            ×
          </button>
        </header>

        <div className="space-y-4 px-6 py-4">
          <Meta label="Target">
            <code className="font-mono text-xs">
              {row.targetType} · {row.targetId}
            </code>
          </Meta>
          {row.correlationId && (
            <Meta label="Correlation ID">
              <code className="font-mono text-xs">{row.correlationId}</code>
            </Meta>
          )}
          {row.ipAddress && (
            <Meta label="IP">
              <code className="font-mono text-xs">{row.ipAddress}</code>
            </Meta>
          )}
          {row.userAgent && (
            <Meta label="User-Agent">
              <code className="font-mono text-xs break-words">
                {row.userAgent}
              </code>
            </Meta>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <JsonBlock title="Before" data={row.before} />
            <JsonBlock title="After" data={row.after} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Meta({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function JsonBlock({ title, data }: { title: string; data: unknown }) {
  if (data == null) {
    return (
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {title}
        </div>
        <div className="mt-1 rounded border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-400">
          (none)
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </div>
      <pre className="mt-1 max-h-[60vh] overflow-auto rounded border border-slate-200 bg-slate-50 p-3 text-xs leading-snug">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
