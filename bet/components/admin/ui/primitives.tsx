"use client";

/**
 * Admin design-system primitives (PR-BET-ADMIN-REDESIGN).
 *
 * One file, fifteen small components, zero external UI deps.
 *
 * Why one file instead of one-component-per-file: every admin page uses
 * 4-8 of these together. Splitting them adds 8 imports per page for no
 * tree-shaking benefit (they're all `"use client"` boundary components
 * that get bundled together anyway). Easier to grep, easier to diff,
 * easier to keep visual rhythm consistent across components when their
 * source is one scroll apart.
 *
 * Tokens live in `app/globals.css` under `[data-theme]` so dark/light
 * mode flows through CSS custom properties. Every component below uses
 * those tokens (`var(--admin-bg-*)`, etc.) — switching theme is a
 * single attribute flip on `<html>`, no React re-render needed.
 */

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/* ============================================================
   Page chrome
   ============================================================ */

/**
 * Standard page header. Title + optional kicker (small uppercase label
 * above), optional description, trailing actions slot. Used at the top
 * of every admin page so the layout reads consistently.
 */
export function PageHeader({
  kicker,
  title,
  description,
  actions,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {kicker && (
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--admin-text-muted)]">
            {kicker}
          </div>
        )}
        <h1 className="truncate text-2xl font-black tracking-tight text-[var(--admin-text-primary)]">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-[var(--admin-text-secondary)]">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Section header inside a page (sub-h2). */
export function SectionTitle({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-[var(--admin-text-primary)]">
        {children}
      </h2>
      {hint && (
        <span className="text-xs text-[var(--admin-text-muted)]">{hint}</span>
      )}
    </div>
  );
}

/* ============================================================
   Surfaces
   ============================================================ */

/**
 * Generic card surface. `tone` lets us shift the border tint to
 * communicate status without forking the component (success/warning/
 * danger tints exist on every admin dashboard somewhere).
 */
export function Card({
  children,
  className = "",
  tone = "neutral",
}: {
  children: ReactNode;
  className?: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  const toneCls = {
    neutral: "border-[var(--admin-border)]",
    success: "border-emerald-500/30",
    warning: "border-amber-500/30",
    danger: "border-rose-500/30",
    info: "border-cyan-500/30",
  }[tone];
  return (
    <div
      className={`rounded-xl border ${toneCls} bg-[var(--admin-surface)] shadow-[var(--admin-shadow)] ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * KPI / stat card used on dashboards. Big number + label + optional
 * delta indicator. `delta > 0` is mint-green, `delta < 0` is rose.
 */
export function StatCard({
  label,
  value,
  hint,
  delta,
  tone = "neutral",
  icon,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  delta?: number;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  icon?: ReactNode;
}) {
  return (
    <Card tone={tone} className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--admin-text-muted)]">
            {label}
          </div>
          <div className="mt-1.5 truncate font-mono text-2xl font-black tabular-nums text-[var(--admin-text-primary)]">
            {value}
          </div>
          {hint && (
            <div className="mt-0.5 text-[11px] text-[var(--admin-text-secondary)]">
              {hint}
            </div>
          )}
        </div>
        {icon && (
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--admin-elevated)] text-[var(--admin-text-secondary)]">
            {icon}
          </div>
        )}
      </div>
      {delta !== undefined && (
        <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold">
          <span
            className={
              delta > 0
                ? "text-emerald-400"
                : delta < 0
                  ? "text-rose-400"
                  : "text-[var(--admin-text-muted)]"
            }
          >
            {delta > 0 ? "▲" : delta < 0 ? "▼" : "—"} {Math.abs(delta).toFixed(1)}%
          </span>
          <span className="text-[var(--admin-text-muted)]">vs last period</span>
        </div>
      )}
    </Card>
  );
}

/** Skeleton placeholder. Pure CSS pulse — no JS shimmer to keep tables
 *  feeling fast. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-[var(--admin-elevated)] ${className}`}
    />
  );
}

/** Empty-state for tables/lists with no data. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon && (
        <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-[var(--admin-elevated)] text-[var(--admin-text-muted)]">
          {icon}
        </div>
      )}
      <div className="text-sm font-bold text-[var(--admin-text-primary)]">
        {title}
      </div>
      {description && (
        <div className="mt-1 max-w-sm text-xs text-[var(--admin-text-secondary)]">
          {description}
        </div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ============================================================
   Buttons + Badges + Pills
   ============================================================ */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg";

/**
 * Button. Variants map to the admin colour scale defined in
 * globals.css. Always renders as a `<button>` — if you need a link
 * styled as a button, use `LinkButton` below (just type-safer than
 * `<button onClick={() => router.push(...)}>`).
 */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  children,
  className = "",
  ...rest
}: {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const sizeCls = {
    sm: "h-7 px-2.5 text-xs",
    md: "h-9 px-3.5 text-sm",
    lg: "h-11 px-5 text-sm",
  }[size];
  const variantCls = {
    primary:
      "bg-cyan-500 text-slate-950 hover:bg-cyan-400 active:bg-cyan-600 disabled:bg-cyan-500/40 disabled:text-slate-700 font-semibold",
    secondary:
      "bg-[var(--admin-elevated)] text-[var(--admin-text-primary)] border border-[var(--admin-border)] hover:bg-[var(--admin-elevated-hi)] hover:border-[var(--admin-border-strong)]",
    ghost:
      "text-[var(--admin-text-secondary)] hover:bg-[var(--admin-elevated)] hover:text-[var(--admin-text-primary)]",
    danger:
      "bg-rose-500 text-white hover:bg-rose-400 active:bg-rose-600 disabled:bg-rose-500/40 font-semibold",
    success:
      "bg-emerald-500 text-slate-950 hover:bg-emerald-400 active:bg-emerald-600 disabled:bg-emerald-500/40 font-semibold",
  }[variant];
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg transition disabled:cursor-not-allowed ${sizeCls} ${variantCls} ${className}`}
    >
      {loading && (
        <span
          aria-hidden
          className="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
      )}
      {children}
    </button>
  );
}

/**
 * Status badge. `tone` controls colour; `dot` adds a small filled circle
 * for status-list contexts (open / closed / resolved / etc.).
 */
export function Badge({
  children,
  tone = "neutral",
  dot = false,
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "violet";
  dot?: boolean;
}) {
  const toneCls = {
    neutral:
      "bg-[var(--admin-elevated)] text-[var(--admin-text-secondary)] border-[var(--admin-border)]",
    success: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    warning: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    danger: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    info: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
    violet: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  }[tone];
  const dotCls = {
    neutral: "bg-slate-400",
    success: "bg-emerald-400",
    warning: "bg-amber-400",
    danger: "bg-rose-400",
    info: "bg-cyan-400",
    violet: "bg-violet-400",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${toneCls}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dotCls}`} />}
      {children}
    </span>
  );
}

/* ============================================================
   Form controls
   ============================================================ */

/**
 * Text input. Forwards every native input prop, just gives it the
 * admin look. `error` renders a red ring + supports `errorMessage`.
 */
export function Input({
  label,
  error,
  errorMessage,
  hint,
  className = "",
  ...rest
}: {
  label?: ReactNode;
  error?: boolean;
  errorMessage?: ReactNode;
  hint?: ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      {label && (
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--admin-text-secondary)]">
          {label}
        </div>
      )}
      <input
        {...rest}
        className={`block w-full rounded-lg border bg-[var(--admin-elevated)] px-3 py-2 text-sm text-[var(--admin-text-primary)] placeholder:text-[var(--admin-text-muted)] focus:outline-none focus:ring-2 ${
          error
            ? "border-rose-500/60 focus:ring-rose-500/30"
            : "border-[var(--admin-border)] focus:border-cyan-500/60 focus:ring-cyan-500/30"
        } ${className}`}
      />
      {errorMessage && (
        <div className="mt-1 text-[11px] text-rose-400">{errorMessage}</div>
      )}
      {hint && !errorMessage && (
        <div className="mt-1 text-[11px] text-[var(--admin-text-muted)]">
          {hint}
        </div>
      )}
    </label>
  );
}

/** Textarea variant of Input. */
export function Textarea({
  label,
  hint,
  className = "",
  ...rest
}: {
  label?: ReactNode;
  hint?: ReactNode;
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block">
      {label && (
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--admin-text-secondary)]">
          {label}
        </div>
      )}
      <textarea
        {...rest}
        className={`block w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-elevated)] px-3 py-2 text-sm text-[var(--admin-text-primary)] placeholder:text-[var(--admin-text-muted)] focus:border-cyan-500/60 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 ${className}`}
      />
      {hint && (
        <div className="mt-1 text-[11px] text-[var(--admin-text-muted)]">
          {hint}
        </div>
      )}
    </label>
  );
}

/** Select. Wraps native `<select>` so keyboard nav stays consistent. */
export function Select({
  label,
  hint,
  className = "",
  children,
  ...rest
}: {
  label?: ReactNode;
  hint?: ReactNode;
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      {label && (
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--admin-text-secondary)]">
          {label}
        </div>
      )}
      <select
        {...rest}
        className={`block w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-elevated)] px-3 py-2 text-sm text-[var(--admin-text-primary)] focus:border-cyan-500/60 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 ${className}`}
      >
        {children}
      </select>
      {hint && (
        <div className="mt-1 text-[11px] text-[var(--admin-text-muted)]">
          {hint}
        </div>
      )}
    </label>
  );
}

/* ============================================================
   Modal / Drawer
   ============================================================ */

/**
 * Centered modal. Escape-key closes; backdrop click closes. Used for
 * confirmation prompts (resolve market, force-cancel order, etc.).
 *
 * Implementation note: rendered as an inline portal (children of the
 * caller, position-fixed) instead of a true React portal — Next.js
 * server components shouldn't import `react-dom`. The z-index + the
 * `data-modal-open` attribute on `<body>` prevent click-through.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
  hideClose = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  hideClose?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.body.setAttribute("data-modal-open", "1");
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.removeAttribute("data-modal-open");
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const sizeCls = {
    sm: "max-w-sm",
    md: "max-w-lg",
    lg: "max-w-2xl",
  }[size];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" aria-hidden />
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full ${sizeCls} rounded-2xl border border-[var(--admin-border-strong)] bg-[var(--admin-surface)] shadow-2xl`}
      >
        {(title || !hideClose) && (
          <div className="flex items-center justify-between border-b border-[var(--admin-divider)] px-5 py-3">
            <div className="text-sm font-bold uppercase tracking-wider text-[var(--admin-text-primary)]">
              {title}
            </div>
            {!hideClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="grid h-7 w-7 place-items-center rounded-md text-[var(--admin-text-muted)] hover:bg-[var(--admin-elevated)] hover:text-[var(--admin-text-primary)]"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="6" y1="18" x2="18" y2="6" />
                </svg>
              </button>
            )}
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ============================================================
   Tabs
   ============================================================ */

/**
 * Tab strip. Each tab is a Next-link so deep-linking works (refresh
 * lands you on the same tab). Pass `tabs: { href, label, count? }[]`.
 */
export function Tabs({
  tabs,
}: {
  tabs: { href: string; label: ReactNode; count?: number }[];
}) {
  const pathname = usePathname() ?? "";
  return (
    <div className="mb-5 flex flex-wrap gap-1 border-b border-[var(--admin-divider)]">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <a
            key={tab.href}
            href={tab.href}
            className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition ${
              active
                ? "border-cyan-400 font-semibold text-[var(--admin-text-primary)]"
                : "border-transparent text-[var(--admin-text-secondary)] hover:border-[var(--admin-border)] hover:text-[var(--admin-text-primary)]"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                  active
                    ? "bg-cyan-500/15 text-cyan-300"
                    : "bg-[var(--admin-elevated)] text-[var(--admin-text-muted)]"
                }`}
              >
                {tab.count}
              </span>
            )}
          </a>
        );
      })}
    </div>
  );
}

/* ============================================================
   DataTable
   ============================================================ */

/**
 * Generic table with sticky header + row hover. Pass `columns` (label
 * + render function) and `rows` (any[]). Row click is optional. Empty
 * state slot kicks in when `rows` is empty.
 *
 * For very large datasets, the caller should paginate server-side
 * (this table doesn't virtualise). With 50-row pages it's fast enough
 * on a mid-range laptop.
 */
export type Column<T> = {
  key: string;
  label: ReactNode;
  /** Tailwind width class, e.g. `w-32`. Omit for auto. */
  width?: string;
  /** Right-align the cell. Use for money / counts. */
  align?: "left" | "right" | "center";
  render: (row: T) => ReactNode;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  empty,
  onRowClick,
  density = "comfortable",
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  density?: "comfortable" | "compact";
}) {
  const rowPad = density === "compact" ? "py-1.5" : "py-2.5";
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)]">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[var(--admin-elevated)] text-[var(--admin-text-muted)]">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`${c.width ?? ""} px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider ${
                    c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : ""
                  }`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-divider)]">
            {loading && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-4/6" />
                  </div>
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={columns.length}>
                  {empty ?? (
                    <EmptyState title="No results" description="Try adjusting your filters." />
                  )}
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`text-[var(--admin-text-primary)] transition ${
                    onRowClick ? "cursor-pointer hover:bg-[var(--admin-elevated)]" : ""
                  }`}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-3 ${rowPad} ${
                        c.align === "right"
                          ? "text-right tabular-nums"
                          : c.align === "center"
                            ? "text-center"
                            : ""
                      }`}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================================================
   Toolbar (filters + search above tables)
   ============================================================ */

export function Toolbar({
  children,
  end,
}: {
  children?: ReactNode;
  end?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {end && <div className="ml-auto flex flex-wrap items-center gap-2">{end}</div>}
    </div>
  );
}

/**
 * Segmented chips, used for status filters. State is owned by the
 * caller — this is a controlled component.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--admin-border)] bg-[var(--admin-elevated)] p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition ${
              active
                ? "bg-cyan-500/15 font-semibold text-cyan-300"
                : "text-[var(--admin-text-secondary)] hover:text-[var(--admin-text-primary)]"
            }`}
          >
            {o.label}
            {o.count !== undefined && (
              <span
                className={`rounded-full px-1 text-[10px] tabular-nums ${
                  active ? "text-cyan-200" : "text-[var(--admin-text-muted)]"
                }`}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================
   Search input (sized for toolbars)
   ============================================================ */

export function SearchInput({
  placeholder = "Search…",
  value,
  onChange,
  className = "",
}: {
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <svg
        aria-hidden
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--admin-text-muted)]"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-56 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-elevated)] pl-8 pr-3 text-xs text-[var(--admin-text-primary)] placeholder:text-[var(--admin-text-muted)] focus:border-cyan-500/60 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
      />
    </div>
  );
}

/* ============================================================
   Toast (light client-side notification)
   ============================================================ */

/**
 * Imperative toast. Usage:
 *   import { toast } from '@/components/admin/ui/primitives';
 *   toast.success('Market resolved');
 *
 * Implementation: single mounted host (see ToastHost below) listens to
 * a custom event. No global Zustand store needed because toasts are
 * fire-and-forget and never need to be queried.
 */
type ToastTone = "success" | "error" | "info" | "warning";
const TOAST_EVENT = "admin-toast";

export const toast = {
  success: (msg: string) => emitToast(msg, "success"),
  error: (msg: string) => emitToast(msg, "error"),
  info: (msg: string) => emitToast(msg, "info"),
  warning: (msg: string) => emitToast(msg, "warning"),
};

function emitToast(msg: string, tone: ToastTone) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(TOAST_EVENT, { detail: { msg, tone, id: Math.random().toString(36).slice(2) } }),
  );
}

interface Toast {
  id: string;
  msg: string;
  tone: ToastTone;
}

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    function handle(e: Event) {
      const detail = (e as CustomEvent).detail as Toast;
      setToasts((t) => [...t, detail]);
      setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== detail.id));
      }, 4000);
    }
    window.addEventListener(TOAST_EVENT, handle);
    return () => window.removeEventListener(TOAST_EVENT, handle);
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex flex-col-reverse gap-2">
      {toasts.map((t) => {
        const toneCls = {
          success: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
          error: "border-rose-500/40 bg-rose-500/15 text-rose-200",
          info: "border-cyan-500/40 bg-cyan-500/15 text-cyan-200",
          warning: "border-amber-500/40 bg-amber-500/15 text-amber-200",
        }[t.tone];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto max-w-sm rounded-lg border px-3 py-2 text-sm shadow-lg backdrop-blur ${toneCls}`}
          >
            {t.msg}
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   Pagination
   ============================================================ */

export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-[var(--admin-text-secondary)]">
      <span>
        Page <span className="font-semibold text-[var(--admin-text-primary)]">{page}</span> of{" "}
        <span className="font-semibold text-[var(--admin-text-primary)]">{totalPages}</span>
      </span>
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

/* ============================================================
   Money / number formatters (UI-shared)
   ============================================================
   PR-BET-HOTFIX-LOCAL — these moved to `./format.ts` (a non-client
   module) so server components can import them. We re-export here
   for back-compat with code that already imports them from the
   primitives module. New code should prefer `import … from
   "@/components/admin/ui/format"` for clarity. */

export { fmtCoins, fmtPct, fmtDate, fmtRelative } from "./format";
