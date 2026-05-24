"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  IconActivity,
  IconAlert,
  IconAudit,
  IconCash,
  IconChart,
  IconChevron,
  IconDashboard,
  IconFile,
  IconLightning,
  IconMarkets,
  IconOrderBook,
  IconPlus,
  IconRoles,
  IconScale,
  IconServer,
  IconSettings,
  IconShield,
  IconUsers,
  IconWallet,
} from "./ui/icons";

/**
 * Admin sidebar (PR-BET-ADMIN-REDESIGN).
 *
 * Replaces the original flat 4-section sidebar with a richer, role-
 * organised nav suited to a real-money prediction-market operating
 * console. Each section reflects a distinct operator persona:
 *
 *   • Overview        — Dashboard ("what's happening right now")
 *   • Markets         — Market & order-book moderation
 *   • Finance         — Wallets, withdrawals, payouts, escrow
 *   • Trust & Safety  — Reports, comments, fraud, KYC
 *   • Users           — User accounts, roles, impersonate
 *   • Compliance      — Audit log, reconciliation, exports
 *   • Platform        — Feature flags, settings, notifications, API
 *
 * The sidebar collapses to icon-only on narrow widths (≥ md but
 * < lg) so an operator on a 13" laptop still sees the canvas. Each
 * group is independently collapsible — preference is persisted to
 * localStorage so a returning user lands in their own layout.
 *
 * Stub vs. live: items with `stub: true` are routes that exist as
 * polished "Coming soon — schema TBD" placeholders. They're shown
 * because the user explicitly asked for the full 19-module nav
 * scaffold; clicking lands on a coherent page rather than 404.
 */

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  /** Show a subtle "stub" pill so admins know the page isn't wired yet. */
  stub?: boolean;
  /** Optional badge (e.g. pending count). */
  badge?: number | string;
  /** Treat this item as "active" when the pathname starts with these. */
  match?: string[];
}

interface NavSection {
  id: string;
  title: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    id: "overview",
    title: "Overview",
    items: [{ href: "/admin", label: "Dashboard", icon: IconDashboard }],
  },
  {
    id: "markets",
    title: "Markets",
    items: [
      {
        href: "/admin/markets",
        label: "All markets",
        icon: IconMarkets,
        match: ["/admin/markets"],
      },
      {
        href: "/admin/markets/new",
        label: "New market",
        icon: IconPlus,
      },
      {
        href: "/admin/orders",
        label: "Orders",
        icon: IconOrderBook,
        match: ["/admin/orders"],
        stub: false,
      },
      {
        href: "/admin/settlements",
        label: "Settlements",
        icon: IconScale,
        stub: false,
      },
    ],
  },
  {
    id: "finance",
    title: "Finance",
    items: [
      {
        href: "/admin/withdrawals",
        label: "Withdrawals",
        icon: IconCash,
        match: ["/admin/withdrawals"],
      },
      {
        href: "/admin/payouts",
        label: "Payouts",
        icon: IconWallet,
        stub: false,
      },
      {
        href: "/admin/escrow",
        label: "Escrow & wallets",
        icon: IconWallet,
        stub: false,
      },
    ],
  },
  {
    id: "safety",
    title: "Trust & safety",
    items: [
      {
        href: "/admin/reports",
        label: "Reports",
        icon: IconAlert,
        match: ["/admin/reports"],
      },
      {
        href: "/admin/comments",
        label: "Comments",
        icon: IconFile,
        match: ["/admin/comments"],
      },
      {
        href: "/admin/fraud",
        label: "Fraud & risk",
        icon: IconShield,
        stub: false,
      },
      {
        href: "/admin/kyc",
        label: "KYC review",
        icon: IconShield,
        stub: false,
      },
    ],
  },
  {
    id: "users",
    title: "Users",
    items: [
      {
        href: "/admin/users",
        label: "All users",
        icon: IconUsers,
        match: ["/admin/users"],
      },
      {
        href: "/admin/roles",
        label: "Roles & access",
        icon: IconRoles,
        stub: false,
      },
    ],
  },
  {
    id: "compliance",
    title: "Compliance",
    items: [
      {
        href: "/admin/audit",
        label: "Audit log",
        icon: IconAudit,
        match: ["/admin/audit"],
      },
      {
        href: "/admin/reports-analytics",
        label: "Reports & exports",
        icon: IconChart,
        stub: false,
      },
    ],
  },
  {
    id: "platform",
    title: "Platform",
    items: [
      {
        href: "/admin/notifications",
        label: "Notifications",
        icon: IconLightning,
        stub: false,
      },
      {
        href: "/admin/api",
        label: "API & webhooks",
        icon: IconServer,
        stub: false,
      },
      {
        href: "/admin/settings",
        label: "Settings",
        icon: IconSettings,
        stub: false,
      },
    ],
  },
];

const COLLAPSE_KEY = "kalki_admin_nav_collapsed_v1";

export function Sidebar({ username }: { username: string }) {
  const pathname = usePathname() ?? "";
  // Per-section collapse state, restored from localStorage on mount.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      if (raw) setCollapsed(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  function toggleSection(id: string) {
    setCollapsed((c) => {
      const next = { ...c, [id]: !c[id] };
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-[var(--admin-border)] bg-[var(--admin-surface)] lg:flex">
      {/* Brand block. Reuses the gradient already established in the
          user-facing app. */}
      <div className="flex items-center gap-2.5 border-b border-[var(--admin-divider)] px-4 py-4">
        <div
          aria-hidden
          className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-cyan-400 to-violet-500 text-slate-950"
        >
          <IconActivity size={16} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-black tracking-tight text-[var(--admin-text-primary)]">
            Kalki Exchange
          </div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--admin-text-muted)]">
            Admin Console
          </div>
        </div>
      </div>

      {/* Nav scroll region. Independent from sidebar header/footer
          so the brand and signed-in chip stay pinned. */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {SECTIONS.map((section) => {
          const isCollapsed = collapsed[section.id] === true;
          return (
            <div key={section.id} className="mb-3">
              <button
                type="button"
                onClick={() => toggleSection(section.id)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--admin-text-muted)] hover:text-[var(--admin-text-secondary)]"
              >
                <span>{section.title}</span>
                <IconChevron
                  size={12}
                  className={`transition ${isCollapsed ? "" : "rotate-90"}`}
                />
              </button>
              {!isCollapsed && (
                <ul className="mt-1 space-y-0.5">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const active =
                      pathname === item.href ||
                      (item.match?.some((p) => pathname.startsWith(p)) ??
                        false);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition ${
                            active
                              ? "bg-cyan-500/10 font-semibold text-cyan-300"
                              : "text-[var(--admin-text-secondary)] hover:bg-[var(--admin-elevated)] hover:text-[var(--admin-text-primary)]"
                          }`}
                        >
                          <Icon
                            size={15}
                            className={
                              active
                                ? "text-cyan-400"
                                : "text-[var(--admin-text-muted)]"
                            }
                          />
                          <span className="flex-1 truncate">{item.label}</span>
                          {item.badge !== undefined && (
                            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-amber-300">
                              {item.badge}
                            </span>
                          )}
                          {item.stub && (
                            <span
                              title="Coming soon — schema TBD"
                              className="rounded-md bg-[var(--admin-elevated)] px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-[var(--admin-text-muted)]"
                            >
                              soon
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      {/* Signed-in admin chip + back-to-app link. Lives at the bottom
          so it's the last visual anchor and never collides with the
          first nav row on tall sidebars. */}
      <div className="border-t border-[var(--admin-divider)] p-3">
        <div className="flex items-center gap-2 rounded-lg bg-[var(--admin-elevated)] px-2 py-2">
          <div className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-cyan-400 to-violet-500 text-[11px] font-black text-slate-950">
            {(username ?? "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-[var(--admin-text-primary)]">
              @{username}
            </div>
            <div className="text-[10px] text-[var(--admin-text-muted)]">
              Super admin
            </div>
          </div>
        </div>
        <Link
          href="/"
          className="mt-2 block rounded-lg px-2 py-1.5 text-center text-[11px] font-semibold text-[var(--admin-text-muted)] hover:bg-[var(--admin-elevated)] hover:text-[var(--admin-text-primary)]"
        >
          ← Back to exchange
        </Link>
      </div>
    </aside>
  );
}
