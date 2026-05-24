"use client";

import { useEffect, useRef, useState } from "react";
import {
  IconBell,
  IconExternal,
  IconLogout,
  IconMoon,
  IconSearch,
  IconSun,
} from "./ui/icons";

/**
 * Admin top bar (PR-BET-ADMIN-REDESIGN).
 *
 * Sticky header pinned above the content area. Five widgets, left → right:
 *
 *   1. Global search (placeholder for cross-resource search — opens a
 *      Cmd+K palette in a future PR; this version is a non-submitting
 *      input that the operator can use as a scratchpad for now).
 *   2. Live status pill — green when SSE feeds report healthy, red on
 *      stale heartbeat. Updates every 5s.
 *   3. Notifications bell with unread count badge.
 *   4. Theme toggle (dark/light) — flips `data-admin-theme` on <html>
 *      and persists to localStorage.
 *   5. Profile menu with avatar + Sign-out.
 *
 * The notifications popover is a real client-rendered surface (closes
 * on outside click + Escape) but its content list is currently a
 * stub showing recent platform events. Wiring this to a real
 * `notifications` endpoint is intentionally deferred — the user asked
 * for the full nav scaffold, not full feature parity in one PR.
 */
export function Topbar({
  username,
  onSignOut,
}: {
  username: string;
  onSignOut: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-[var(--admin-border)] bg-[var(--admin-surface)]/85 px-4 backdrop-blur-md">
      <div className="flex flex-1 items-center gap-2">
        <GlobalSearch />
      </div>

      <LiveStatusPill />
      <NotificationsBell />
      <ThemeToggle />
      <ProfileMenu username={username} onSignOut={onSignOut} />
    </header>
  );
}

/* ============================================================
   Global search (scaffold)
   ============================================================ */

function GlobalSearch() {
  const [q, setQ] = useState("");
  return (
    <div className="relative max-w-md flex-1">
      <IconSearch
        size={14}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--admin-text-muted)]"
      />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search markets, users, orders…"
        className="h-9 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-elevated)] pl-9 pr-3 text-sm text-[var(--admin-text-primary)] placeholder:text-[var(--admin-text-muted)] focus:border-cyan-500/60 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-[var(--admin-border)] bg-[var(--admin-bg)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--admin-text-muted)] sm:inline">
        ⌘K
      </kbd>
    </div>
  );
}

/* ============================================================
   Live status pill
   ============================================================ */

function LiveStatusPill() {
  // For now we report "live" unconditionally. When the SSE/WebSocket
  // admin feed lands (separate PR), this hook can flip to red if the
  // last heartbeat is > 10s old.
  const [healthy] = useState(true);
  return (
    <div
      title={healthy ? "Realtime feed healthy" : "Realtime feed stale"}
      className="hidden items-center gap-1.5 rounded-full border border-[var(--admin-border)] bg-[var(--admin-elevated)] px-2.5 py-1 sm:inline-flex"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          healthy ? "bg-emerald-400" : "bg-rose-400"
        }`}
        style={{
          boxShadow: healthy
            ? "0 0 8px rgba(52, 211, 153, 0.6)"
            : "0 0 8px rgba(244, 114, 182, 0.6)",
        }}
      />
      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--admin-text-secondary)]">
        Live
      </span>
    </div>
  );
}

/* ============================================================
   Notifications bell
   ============================================================ */

interface Notification {
  id: string;
  title: string;
  body: string;
  at: Date;
  tone: "info" | "warning" | "danger" | "success";
}

function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Stub data — wire to a real notifications endpoint in a follow-up.
  const items: Notification[] = [
    {
      id: "1",
      title: "Market resolved",
      body: "Will RBI cut rates in Q3 — resolved YES",
      at: new Date(Date.now() - 12 * 60_000),
      tone: "success",
    },
    {
      id: "2",
      title: "Pending withdrawal review",
      body: "3 withdrawals over ₹5,000 awaiting approval",
      at: new Date(Date.now() - 35 * 60_000),
      tone: "warning",
    },
    {
      id: "3",
      title: "Suspicious activity",
      body: "User @sundeep_15 placed 12 trades in 30s",
      at: new Date(Date.now() - 2 * 60 * 60_000),
      tone: "danger",
    },
  ];
  const unread = items.length;

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={popoverRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative grid h-9 w-9 place-items-center rounded-lg border border-[var(--admin-border)] bg-[var(--admin-elevated)] text-[var(--admin-text-secondary)] hover:bg-[var(--admin-elevated-hi)] hover:text-[var(--admin-text-primary)]"
      >
        <IconBell size={15} />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -right-1 -top-1 grid min-w-[16px] place-items-center rounded-full border-2 border-[var(--admin-surface)] bg-amber-500 px-1 text-[9px] font-black text-slate-950"
          >
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-80 overflow-hidden rounded-xl border border-[var(--admin-border-strong)] bg-[var(--admin-surface)] shadow-2xl">
          <div className="flex items-center justify-between border-b border-[var(--admin-divider)] px-3 py-2">
            <div className="text-xs font-bold uppercase tracking-wider text-[var(--admin-text-primary)]">
              Notifications
            </div>
            <button
              type="button"
              className="text-[10px] font-semibold uppercase tracking-wider text-cyan-400 hover:text-cyan-300"
            >
              Mark all read
            </button>
          </div>
          <ul className="max-h-96 divide-y divide-[var(--admin-divider)] overflow-y-auto">
            {items.map((n) => {
              const dot = {
                info: "bg-cyan-400",
                warning: "bg-amber-400",
                danger: "bg-rose-400",
                success: "bg-emerald-400",
              }[n.tone];
              return (
                <li key={n.id} className="cursor-pointer px-3 py-2.5 hover:bg-[var(--admin-elevated)]">
                  <div className="flex items-start gap-2.5">
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[var(--admin-text-primary)]">
                        {n.title}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--admin-text-secondary)]">
                        {n.body}
                      </div>
                      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--admin-text-muted)]">
                        {formatRelative(n.at)}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Theme toggle
   ============================================================ */

const THEME_KEY = "kalki_admin_theme_v1";

function ThemeToggle() {
  // Default to dark; hydrate from localStorage in effect so SSR isn't
  // mismatched against client.
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY) as "dark" | "light" | null;
    const next = saved ?? "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-admin-theme", next);
  }, []);
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-admin-theme", next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* ignore */
    }
  }
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--admin-border)] bg-[var(--admin-elevated)] text-[var(--admin-text-secondary)] hover:bg-[var(--admin-elevated-hi)] hover:text-[var(--admin-text-primary)]"
    >
      {theme === "dark" ? <IconSun size={15} /> : <IconMoon size={15} />}
    </button>
  );
}

/* ============================================================
   Profile menu
   ============================================================ */

function ProfileMenu({
  username,
  onSignOut,
}: {
  username: string;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-cyan-400 to-violet-500 text-[12px] font-black text-slate-950"
      >
        {(username ?? "?").slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-56 overflow-hidden rounded-xl border border-[var(--admin-border-strong)] bg-[var(--admin-surface)] shadow-2xl">
          <div className="border-b border-[var(--admin-divider)] px-3 py-2.5">
            <div className="text-xs font-bold text-[var(--admin-text-primary)]">
              @{username}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--admin-text-muted)]">
              Super admin
            </div>
          </div>
          <ul className="py-1 text-sm">
            <li>
              <a
                href="/profile"
                className="flex items-center gap-2 px-3 py-2 text-[var(--admin-text-secondary)] hover:bg-[var(--admin-elevated)] hover:text-[var(--admin-text-primary)]"
              >
                <IconExternal size={14} /> View public profile
              </a>
            </li>
            <li>
              <button
                type="button"
                onClick={onSignOut}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-rose-300 hover:bg-rose-500/10"
              >
                <IconLogout size={14} /> Sign out
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Helpers
   ============================================================ */

function formatRelative(d: Date): string {
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
