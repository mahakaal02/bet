import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';

/**
 * Admin Settings page — grouped editor backed by
 * `GET/PATCH /admin/settings`. Each row is a `SystemSetting`
 * catalog entry; editing one writes through the typed coercion
 * + audit log + history-row chain in `SettingsService`.
 *
 * UI shape:
 *   1. Group tabs at top — wallet, aviator, auctions, … —
 *      driven by the response, not hard-coded, so new catalog
 *      groups appear automatically.
 *   2. One card per setting in the active group: key, value,
 *      type chip, updated-by, "Edit" + "History" affordances.
 *   3. Edit modal with type-aware input + an optional reason
 *      field, and a stronger warning band for keys tagged
 *      `critical` (wallet caps, KYC tiers).
 *   4. History side panel: chronological before/after rows
 *      for the selected key.
 *
 * Errors surface inline (not as toasts) — admins benefit from
 * acknowledged failure, especially on a screen that can move
 * money caps with one click.
 */

type SettingType = 'INT' | 'FLOAT' | 'STRING' | 'BOOL' | 'JSON';

interface SettingRow {
  key: string;
  value: unknown;
  valueType: SettingType;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string;
  critical: boolean;
  group: string;
  groupLabel: string;
}

interface GroupSummary {
  id: string;
  label: string;
  keys: string[];
}

interface ListResponse {
  groups: GroupSummary[];
  items: SettingRow[];
}

interface HistoryRow {
  id: string;
  key: string;
  before: unknown;
  after: unknown;
  changedBy: string;
  changedAt: string;
}

export default function Settings() {
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SettingRow | null>(null);
  const [historyFor, setHistoryFor] = useState<SettingRow | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.get<ListResponse>('/admin/settings');
      setRows(res.items);
      setGroups(res.groups);
      setActiveGroup((prev) => prev ?? res.groups[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'failed to load settings');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const visibleRows = useMemo(
    () => rows.filter((r) => !activeGroup || r.group === activeGroup),
    [rows, activeGroup],
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-indigo-dark">
          Runtime settings
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Live-edit the values that gate wallet caps, KYC tiers,
          aviator stake limits, and more. Changes are audited and
          take effect within a minute (per-pod cache TTL).
        </p>
      </header>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {groups.length > 0 && (
        <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setActiveGroup(g.id)}
              className={`px-3 py-1.5 rounded text-sm transition ${
                activeGroup === g.id
                  ? 'bg-brand-indigo text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {g.label}{' '}
              <span className="opacity-60">({g.keys.length})</span>
            </button>
          ))}
        </nav>
      )}

      {busy && rows.length === 0 ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : (
        <div className="space-y-3">
          {visibleRows.map((r) => (
            <SettingCard
              key={r.key}
              row={r}
              onEdit={() => setEditing(r)}
              onHistory={() => setHistoryFor(r)}
            />
          ))}
          {visibleRows.length === 0 && (
            <div className="rounded border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
              No settings in this group.
            </div>
          )}
        </div>
      )}

      {editing && (
        <EditModal
          row={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}

      {historyFor && (
        <HistoryPanel
          row={historyFor}
          onClose={() => setHistoryFor(null)}
        />
      )}
    </div>
  );
}

function SettingCard({
  row,
  onEdit,
  onHistory,
}: {
  row: SettingRow;
  onEdit: () => void;
  onHistory: () => void;
}) {
  return (
    <div className="rounded border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <code className="text-sm font-mono text-brand-indigo-dark break-all">
              {row.key}
            </code>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-600">
              {row.valueType}
            </span>
            {row.critical && (
              <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] uppercase tracking-wider text-red-700">
                Critical
              </span>
            )}
          </div>
          {row.description && (
            <p className="mt-1 text-sm text-slate-600">{row.description}</p>
          )}
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-xs uppercase tracking-wider text-slate-400">
              Current
            </span>
            <code className="font-mono text-sm text-slate-900 break-all">
              {formatValue(row.value)}
            </code>
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Last changed by {row.updatedBy ?? 'system'}{' '}
            on {new Date(row.updatedAt).toLocaleString()}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onHistory}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            History
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="rounded bg-brand-indigo px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-indigo-dark"
          >
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}

function EditModal({
  row,
  onCancel,
  onSaved,
}: {
  row: SettingRow;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [rawValue, setRawValue] = useState(() => valueToInputString(row));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const parsed = parseInputForType(rawValue, row.valueType);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    if (row.critical && !reason.trim()) {
      setError('reason is required for critical settings');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/admin/settings/${encodeURIComponent(row.key)}`, {
        value: parsed.value,
        reason: reason.trim() || undefined,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'save failed');
      setBusy(false);
    }
  }

  const unchanged = rawValue === valueToInputString(row);

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-slate-900/60 px-4 py-12">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-brand-indigo-dark">
            Edit setting
          </h2>
          <code className="mt-1 block text-sm font-mono text-slate-600 break-all">
            {row.key}
          </code>
        </div>
        <div className="space-y-4 px-6 py-5">
          {row.critical && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <strong>Critical setting.</strong> This value gates
              wallet caps or compliance limits. A reason is
              required and the change is captured in the audit log.
            </div>
          )}
          {row.description && (
            <p className="text-sm text-slate-600">{row.description}</p>
          )}
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-slate-500">
              New value ({row.valueType.toLowerCase()})
            </label>
            <ValueInput
              valueType={row.valueType}
              value={rawValue}
              onChange={setRawValue}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-slate-500">
              Reason {row.critical && <span className="text-red-600">*</span>}
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Short note for the audit log"
              maxLength={500}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-indigo focus:outline-none"
            />
          </div>
          <div className="rounded bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <div>
              <span className="text-slate-400">Before:</span>{' '}
              <code className="font-mono">{formatValue(row.value)}</code>
            </div>
            <div className="mt-1">
              <span className="text-slate-400">After:</span>{' '}
              <code className="font-mono">{rawValue || '(empty)'}</code>
            </div>
          </div>
          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || unchanged}
            className="rounded bg-brand-indigo px-4 py-2 text-sm font-medium text-white hover:bg-brand-indigo-dark disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save change'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ValueInput({
  valueType,
  value,
  onChange,
}: {
  valueType: SettingType;
  value: string;
  onChange: (s: string) => void;
}) {
  if (valueType === 'BOOL') {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-indigo focus:outline-none"
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (valueType === 'JSON') {
    return (
      <textarea
        rows={6}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm focus:border-brand-indigo focus:outline-none"
      />
    );
  }
  return (
    <input
      type={valueType === 'INT' || valueType === 'FLOAT' ? 'number' : 'text'}
      step={valueType === 'INT' ? '1' : 'any'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-indigo focus:outline-none"
    />
  );
}

function HistoryPanel({
  row,
  onClose,
}: {
  row: SettingRow;
  onClose: () => void;
}) {
  const [items, setItems] = useState<HistoryRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get<{ items: HistoryRow[] }>(
          `/admin/settings/${encodeURIComponent(row.key)}/history`,
        );
        setItems(res.items);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'failed to load history');
      } finally {
        setBusy(false);
      }
    })();
  }, [row.key]);

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-slate-900/60">
      <aside className="flex w-full max-w-lg flex-col bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-brand-indigo-dark">
                Change history
              </h2>
              <code className="mt-1 block text-sm font-mono text-slate-600 break-all">
                {row.key}
              </code>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {busy && (
            <div className="text-sm text-slate-500">Loading…</div>
          )}
          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}
          {!busy && !error && items.length === 0 && (
            <div className="text-sm text-slate-500">
              No history yet — this setting has not been changed.
            </div>
          )}
          <ul className="space-y-3">
            {items.map((h) => (
              <li
                key={h.id}
                className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
              >
                <div className="flex justify-between text-xs text-slate-500">
                  <span>{new Date(h.changedAt).toLocaleString()}</span>
                  <span>by {h.changedBy}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">
                      Before
                    </div>
                    <code className="font-mono text-xs text-slate-700 break-all">
                      {formatValue(h.before)}
                    </code>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">
                      After
                    </div>
                    <code className="font-mono text-xs text-slate-700 break-all">
                      {formatValue(h.after)}
                    </code>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '(unset)';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function valueToInputString(row: SettingRow): string {
  if (row.value === null || row.value === undefined) return '';
  if (row.valueType === 'JSON' || typeof row.value === 'object') {
    return JSON.stringify(row.value, null, 2);
  }
  return String(row.value);
}

function parseInputForType(
  raw: string,
  type: SettingType,
): { value: unknown } | { error: string } {
  const trimmed = raw.trim();
  if (trimmed === '') return { error: 'value is required' };
  switch (type) {
    case 'INT': {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        return { error: 'value must be an integer' };
      }
      return { value: n };
    }
    case 'FLOAT': {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) {
        return { error: 'value must be a finite number' };
      }
      return { value: n };
    }
    case 'STRING':
      return { value: raw };
    case 'BOOL':
      return { value: trimmed === 'true' };
    case 'JSON':
      try {
        return { value: JSON.parse(trimmed) };
      } catch {
        return { error: 'value must be valid JSON' };
      }
  }
}
