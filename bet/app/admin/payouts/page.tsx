import Link from "next/link";
import {
  db } from "@/lib/db";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  StatCard,
} from "@/components/admin/ui/primitives";
import { fmtCoins, fmtDate } from "@/components/admin/ui/format";
import { IconCash, IconWallet } from "@/components/admin/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Payout dashboard (PR-BET-ADMIN-REDESIGN).
 *
 * Reads from the existing `Transaction` ledger filtered to
 * resolution-related kinds (resolution_payout / resolution_refund).
 * Once the Settlement table starts filling, this view will pivot
 * to also show queued / failed / retrying rows from there.
 */
export default async function PayoutsPage() {
  const last30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [recent, totals, settlements] = await Promise.all([
    db.transaction.findMany({
      where: {
        kind: { in: ["resolution_payout", "resolution_refund"] },
        createdAt: { gte: last30 },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: { select: { username: true } } },
    }),
    db.transaction.aggregate({
      where: {
        kind: { in: ["resolution_payout", "resolution_refund"] },
        createdAt: { gte: last30 },
      },
      _sum: { delta: true },
      _count: { _all: true },
    }),
    db.settlement.findMany({
      where: { status: "FAILED" },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const totalPaid = Number(totals._sum.delta ?? 0);

  return (
    <>
      <PageHeader
        kicker="Finance"
        title="Payouts"
        description="Resolution-time wallet credits & refunds. Failed rows surface in the retry strip below."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Paid out (30d)"
          value={fmtCoins(totalPaid)}
          hint={`${totals._count._all} transactions`}
          tone="success"
          icon={<IconCash size={18} />}
        />
        <StatCard
          label="Successful payouts"
          value={recent.filter((r) => r.kind === "resolution_payout").length.toLocaleString("en-IN")}
          tone="info"
          icon={<IconWallet size={18} />}
        />
        <StatCard
          label="Failed (need retry)"
          value={settlements.length.toLocaleString("en-IN")}
          tone={settlements.length > 0 ? "danger" : "success"}
          hint={settlements.length === 0 ? "No incidents" : "Action required"}
          icon={<IconCash size={18} />}
        />
      </div>

      {settlements.length > 0 && (
        <Card tone="danger" className="mb-5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Badge tone="danger" dot>
              {settlements.length} failed
            </Badge>
            <span className="text-sm font-bold text-[var(--admin-text-primary)]">
              Settlements requiring retry
            </span>
          </div>
          <ul className="space-y-1 text-xs text-[var(--admin-text-secondary)]">
            {settlements.map((s) => (
              <li key={s.id} className="flex items-center justify-between">
                <span className="font-mono">{s.id.slice(0, 8)}…</span>
                <span>{s.lastError ?? "Unknown error"}</span>
                <span>attempts: {s.attempts}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="border-b border-[var(--admin-divider)] px-4 py-3">
          <div className="text-sm font-bold uppercase tracking-wider text-[var(--admin-text-primary)]">
            Recent payouts (30d)
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-[var(--admin-text-muted)]">
            <tr>
              <th className="px-3 py-2 text-left">User</th>
              <th className="px-3 py-2 text-left">Kind</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-divider)]">
            {recent.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <EmptyState
                    icon={<IconWallet size={18} />}
                    title="No resolution payouts yet"
                    description="When a market resolves, winning users' wallet credits show here."
                  />
                </td>
              </tr>
            )}
            {recent.map((t) => (
              <tr key={t.id}>
                <td className="px-3 py-2">
                  <Link href={`/admin/users/${t.userId}`} className="font-semibold hover:text-cyan-300">
                    @{t.user.username}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <Badge tone={t.kind === "resolution_payout" ? "success" : "info"}>
                    {t.kind === "resolution_payout" ? "Payout" : "Refund"}
                  </Badge>
                </td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums ${t.delta > 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  {t.delta > 0 ? "+" : ""}
                  {fmtCoins(t.delta)}
                </td>
                <td className="px-3 py-2 text-right text-[11px] text-[var(--admin-text-secondary)]">
                  {fmtDate(t.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
