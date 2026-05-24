import Link from "next/link";
import { db } from "@/lib/db";
import {
  Card,
  EmptyState,
  PageHeader,
  StatCard,
  fmtCoins,
  fmtDate,
} from "@/components/admin/ui/primitives";
import { IconScale, IconWallet } from "@/components/admin/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Treasury & escrow (PR-BET-ADMIN-REDESIGN).
 *
 * Aggregates Wallet rows into total liquid + total locked, then
 * provides a sorted leaderboard of the top-balance wallets (which
 * are typically what an operator wants to investigate when reserve
 * ratio looks off).
 */
export default async function EscrowPage() {
  const [totals, biggest, recentDeposits, recentWithdrawals] = await Promise.all([
    db.wallet.aggregate({
      _sum: { balance: true, lockedInOrders: true },
      _count: { _all: true },
    }),
    db.wallet.findMany({
      orderBy: { balance: "desc" },
      take: 25,
      include: { user: { select: { id: true, username: true, email: true } } },
    }),
    db.transaction.findMany({
      where: { kind: "deposit", delta: { gt: 0 } },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { user: { select: { username: true } } },
    }),
    db.withdrawalRequest.findMany({
      where: { status: "APPROVED" },
      orderBy: { decidedAt: "desc" },
      take: 10,
      include: { user: { select: { username: true } } },
    }),
  ]);

  const liquid = Number(totals._sum.balance ?? 0);
  const locked = Number(totals._sum.lockedInOrders ?? 0);
  const total = liquid + locked;
  // A simple reserve ratio: liquid / total. Below 0.8 is the
  // boundary where ops should start watching.
  const reserveRatio = total > 0 ? liquid / total : 1;

  return (
    <>
      <PageHeader
        kicker="Finance"
        title="Escrow & wallets"
        description="Platform-wide float, reserve ratio, and a leaderboard of biggest user balances."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Liquid float"
          value={fmtCoins(liquid)}
          hint="Available wallet balances"
          tone="info"
          icon={<IconWallet size={18} />}
        />
        <StatCard
          label="Locked"
          value={fmtCoins(locked)}
          hint="Reserved by open orders / positions"
          icon={<IconScale size={18} />}
        />
        <StatCard
          label="Total float"
          value={fmtCoins(total)}
          hint={`${totals._count._all} wallets`}
        />
        <StatCard
          label="Reserve ratio"
          value={`${(reserveRatio * 100).toFixed(1)}%`}
          hint={
            reserveRatio >= 0.8
              ? "Healthy"
              : reserveRatio >= 0.5
                ? "Watch — locked share rising"
                : "Low — escalate to treasury"
          }
          tone={reserveRatio >= 0.8 ? "success" : reserveRatio >= 0.5 ? "warning" : "danger"}
          icon={<IconScale size={18} />}
        />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-[var(--admin-divider)] px-4 py-3">
          <div className="text-sm font-bold uppercase tracking-wider text-[var(--admin-text-primary)]">
            Top wallets
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-[var(--admin-text-muted)]">
            <tr>
              <th className="px-3 py-2 text-left">User</th>
              <th className="px-3 py-2 text-right">Balance</th>
              <th className="px-3 py-2 text-right">Locked</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-divider)]">
            {biggest.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <EmptyState
                    icon={<IconWallet size={18} />}
                    title="No wallets yet"
                  />
                </td>
              </tr>
            )}
            {biggest.map((w) => (
              <tr key={w.id}>
                <td className="px-3 py-2">
                  <Link href={`/admin/users/${w.userId}`} className="font-semibold hover:text-cyan-300">
                    @{w.user.username}
                  </Link>
                  <div className="text-[10px] text-[var(--admin-text-muted)]">{w.user.email}</div>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtCoins(w.balance)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--admin-text-secondary)]">
                  {fmtCoins(w.lockedInOrders)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold">
                  {fmtCoins(w.balance + w.lockedInOrders)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-[var(--admin-divider)] px-4 py-3">
            <div className="text-sm font-bold uppercase tracking-wider text-[var(--admin-text-primary)]">Recent deposits</div>
          </div>
          <ul className="divide-y divide-[var(--admin-divider)] text-xs">
            {recentDeposits.length === 0 && (
              <li className="px-4 py-6 text-center text-[var(--admin-text-muted)]">No recent deposits.</li>
            )}
            {recentDeposits.map((t) => (
              <li key={t.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">@{t.user.username}</span>
                  <span className="font-mono text-emerald-300 tabular-nums">+{fmtCoins(t.delta)}</span>
                </div>
                <div className="text-[10px] text-[var(--admin-text-muted)]">{fmtDate(t.createdAt)}</div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-[var(--admin-divider)] px-4 py-3">
            <div className="text-sm font-bold uppercase tracking-wider text-[var(--admin-text-primary)]">Recent withdrawals</div>
          </div>
          <ul className="divide-y divide-[var(--admin-divider)] text-xs">
            {recentWithdrawals.length === 0 && (
              <li className="px-4 py-6 text-center text-[var(--admin-text-muted)]">No approved withdrawals.</li>
            )}
            {recentWithdrawals.map((w) => (
              <li key={w.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">@{w.user.username}</span>
                  <span className="font-mono text-rose-300 tabular-nums">−{fmtCoins(w.amountCoins)}</span>
                </div>
                <div className="text-[10px] text-[var(--admin-text-muted)]">
                  via {w.payoutMethod} · {fmtDate(w.decidedAt ?? w.createdAt)}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
