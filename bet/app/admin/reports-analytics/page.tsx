import Link from "next/link";
import { db } from "@/lib/db";
import {
  Card,
  PageHeader,
  StatCard,
  fmtCoins,
} from "@/components/admin/ui/primitives";
import { IconChart, IconDownload, IconFile } from "@/components/admin/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Reports & exports (PR-BET-ADMIN-REDESIGN).
 *
 * Pre-built CSV exports keyed by an `?type=` query param. Each
 * template is a server-streamed CSV through the existing
 * `/api/admin/reports/[type]/export` route (wired below).
 */

const TEMPLATES = [
  {
    type: "revenue",
    title: "Platform revenue",
    description: "Daily revenue series with breakdown by fee type.",
    range: "Last 90 days",
  },
  {
    type: "markets",
    title: "Market performance",
    description: "Per-market volume, P&L, participant count, resolution outcome.",
    range: "Lifetime",
  },
  {
    type: "users-pnl",
    title: "User profitability",
    description: "Per-user net P&L across positions + trade history.",
    range: "Lifetime",
  },
  {
    type: "withdrawals",
    title: "Withdrawal log",
    description: "Approved withdrawals with Razorpay payout references — useful for GST returns.",
    range: "Last 90 days",
  },
  {
    type: "audit",
    title: "Admin audit",
    description: "Every admin action (market.create / resolve / user.ban / setting.update / …).",
    range: "Lifetime",
  },
];

export default async function ReportsPage() {
  const [revenue, marketCount, userCount, withdrawalCount] = await Promise.all([
    db.platformRevenue.findFirst(),
    db.market.count(),
    db.user.count(),
    db.withdrawalRequest.count({ where: { status: "APPROVED" } }),
  ]);

  return (
    <>
      <PageHeader
        kicker="Compliance"
        title="Reports & exports"
        description="Pre-built CSV reports for finance, compliance, and audit. Click a template to download."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <StatCard
          label="Lifetime revenue"
          value={fmtCoins(Number(revenue?.totalPlatformRevenue ?? 0))}
          icon={<IconChart size={18} />}
        />
        <StatCard label="Markets" value={marketCount.toLocaleString("en-IN")} icon={<IconFile size={18} />} />
        <StatCard label="Users" value={userCount.toLocaleString("en-IN")} icon={<IconFile size={18} />} />
        <StatCard
          label="Approved withdrawals"
          value={withdrawalCount.toLocaleString("en-IN")}
          icon={<IconDownload size={18} />}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TEMPLATES.map((t) => (
          <Card key={t.type} className="p-4 transition hover:border-cyan-500/40">
            <div className="mb-2 flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--admin-elevated)] text-[var(--admin-text-secondary)]">
                <IconFile size={16} />
              </div>
              <div className="text-sm font-bold text-[var(--admin-text-primary)]">{t.title}</div>
            </div>
            <p className="text-xs text-[var(--admin-text-secondary)]">{t.description}</p>
            <p className="mt-1 text-[10px] uppercase tracking-wider text-[var(--admin-text-muted)]">{t.range}</p>
            <Link
              href={`/api/admin/reports/${t.type}/export`}
              className="mt-3 inline-flex h-7 items-center gap-1 rounded-md bg-cyan-500/15 px-2.5 text-[11px] font-semibold text-cyan-300 hover:bg-cyan-500/25"
            >
              <IconDownload size={12} /> Download CSV
            </Link>
          </Card>
        ))}
      </div>
    </>
  );
}
