"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
  // Highlight the link as "current" when the pathname starts with one of
  // these prefixes (in addition to exact equality with `href`).
  match?: string[];
}

const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Overview",
    items: [{ href: "/admin", label: "Dashboard" }],
  },
  {
    title: "Markets",
    items: [
      { href: "/admin/markets/new", label: "New market" },
      // The market list lives on /admin (recent markets table). A
      // dedicated /admin/markets index would duplicate that for now;
      // surface the moderation-adjacent deep links instead.
    ],
  },
  {
    title: "Moderation",
    items: [
      { href: "/admin/withdrawals", label: "Withdrawals", match: ["/admin/withdrawals"] },
      { href: "/admin/reports", label: "Reports", match: ["/admin/reports"] },
      { href: "/admin/comments", label: "Comments", match: ["/admin/comments"] },
      { href: "/admin/users", label: "Users", match: ["/admin/users"] },
    ],
  },
  {
    title: "Audit",
    items: [
      { href: "/admin/audit", label: "Activity log", match: ["/admin/audit"] },
    ],
  },
];

/**
 * Persistent left nav for every /admin/* page. Active highlighting
 * checks both exact equality and prefix-match against `item.match`, so
 * deep-link surfaces like `/admin/users/<id>/audit` still flag the
 * parent "Users" link as current.
 */
export function AdminSidebar() {
  const pathname = usePathname() ?? "";

  return (
    <aside className="hidden w-56 shrink-0 lg:block">
      <nav className="sticky top-4 space-y-5">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <div className="px-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              {section.title}
            </div>
            <ul className="mt-1 space-y-0.5">
              {section.items.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.match?.some((prefix) => pathname.startsWith(prefix)) ??
                    false);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={
                        "block rounded-md px-3 py-1.5 text-sm transition " +
                        (active
                          ? "bg-cyan-500/10 text-cyan-200 font-semibold"
                          : "text-slate-400 hover:bg-slate-900/60 hover:text-slate-200")
                      }
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
