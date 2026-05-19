"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Tab strip for the per-market admin surfaces. Active tab is computed
 * from the URL — usePathname forces this component into a client
 * boundary, which is the right tradeoff since each tab's active state
 * needs to flip without a remount.
 */
export function MarketTabs({ marketId }: { marketId: string }) {
  const pathname = usePathname() ?? "";
  const base = `/admin/markets/${marketId}`;
  const tabs: { href: string; label: string }[] = [
    { href: base, label: "Overview" },
    { href: `${base}/orders`, label: "Order book" },
    { href: `${base}/trades`, label: "Trades" },
    { href: `${base}/positions`, label: "Positions" },
  ];

  return (
    <div className="mt-4 flex gap-1 border-b border-slate-800">
      {tabs.map((t) => {
        // Overview is the bare market path — match exactly so deeper
        // routes don't also activate it.
        const active =
          t.href === base ? pathname === base : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              "border-b-2 px-3 py-2 text-sm font-semibold transition " +
              (active
                ? "border-cyan-400 text-cyan-200"
                : "border-transparent text-slate-400 hover:text-slate-200")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
