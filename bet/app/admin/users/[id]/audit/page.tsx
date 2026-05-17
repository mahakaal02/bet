import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { fmtCoins, fmtPrice, timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Per-user audit page for the admin's anti-malpractice review. Aggregates
 * every wallet-affecting datum about the user so a moderator can verify
 * (before approving a withdrawal) that their coins were earned, not
 * manipulated:
 *
 *   - Wallet balance + flags (banned, emailVerified)
 *   - Aggregated ledger by transaction kind (where did the coins come from?)
 *   - Pending / past withdrawals (with IP + UA for cross-account checks)
 *   - Recent trade history (orderbook + AMM + smart)
 *   - Open positions with mark-to-market P/L
 *   - Achievement count (sanity check vs trade count)
 *
 * Everything is computed server-side from existing tables — no aggregation
 * job needed.
 */
export default async function UserAuditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await getAuthedUser();
  if (!me) redirect("/login");
  if (!me.isAdmin) redirect("/");
  const { id } = await params;

  const user = await db.user.findUnique({
    where: { id },
    include: {
      wallet: true,
      _count: {
        select: {
          trades: true,
          positions: true,
          withdrawals: true,
          orders: true,
          achievements: true,
          comments: true,
        },
      },
    },
  });
  if (!user) notFound();

  // Aggregate transactions by kind so the admin sees "+50,000 from
  // wallet_topup, +18,000 from resolution_payout, -65,000 from trade_buy"
  // at a glance.
  const txByKind = await db.transaction.groupBy({
    by: ["kind"],
    where: { userId: id },
    _sum: { delta: true },
    _count: { _all: true },
  });
  txByKind.sort(
    (a, b) => Math.abs(b._sum.delta ?? 0) - Math.abs(a._sum.delta ?? 0),
  );

  const recentTxns = await db.transaction.findMany({
    where: { userId: id },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  const trades = await db.trade.findMany({
    where: { userId: id },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { market: { select: { slug: true, title: true } } },
  });

  const positions = await db.position.findMany({
    where: { userId: id, shares: { gt: 0 } },
    include: { market: true },
    orderBy: { updatedAt: "desc" },
  });

  const withdrawals = await db.withdrawalRequest.findMany({
    where: { userId: id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  // Mark-to-market roll-up so the admin can compare claimed P/L against
  // wallet inflow / outflow patterns.
  let positionValue = 0;
  let positionCost = 0;
  for (const p of positions) {
    const live =
      p.market.status === "RESOLVED" || p.market.status === "CANCELLED"
        ? p.market.resolvedAs === p.outcome
          ? 1
          : 0
        : p.outcome === "YES"
          ? p.market.noShares / (p.market.yesShares + p.market.noShares)
          : p.market.yesShares / (p.market.yesShares + p.market.noShares);
    positionValue += p.shares * live;
    positionCost += p.costBasis;
  }

  // Group withdrawals by IP to spot multi-account abuse — if two
  // different users have ever submitted from the same IP, surface that
  // on the audit page so the admin can investigate before approving.
  const userIps = withdrawals
    .map((w) => w.ipAddress)
    .filter((x): x is string => !!x);
  const ipMatches =
    userIps.length > 0
      ? await db.withdrawalRequest.findMany({
          where: {
            userId: { not: id },
            ipAddress: { in: userIps },
          },
          include: { user: { select: { id: true, username: true } } },
          take: 10,
        })
      : [];

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-5xl px-4 py-6">
        <Link
          href="/admin/withdrawals"
          className="mb-3 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to withdrawals
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black">{user.username}</h1>
            <p className="text-xs text-slate-500">{user.email}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {user.isAdmin && <Badge tone="warn">Admin</Badge>}
              {user.banned && <Badge tone="no">Banned</Badge>}
              {!user.emailVerified && <Badge tone="warn">Unverified</Badge>}
              <Badge>Joined {timeAgo(user.createdAt)}</Badge>
              <Badge>Lvl {user.level} · {user.xp} XP</Badge>
            </div>
          </div>
          <Link
            href={`/admin/users/${user.id}`}
            className="text-xs text-cyan-300 hover:text-cyan-200"
          >
            Manage flags / balance →
          </Link>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <StatBox
            label="Wallet"
            value={`${fmtCoins(user.wallet?.balance ?? 0)}`}
            tone="info"
          />
          <StatBox label="Trades" value={fmtCoins(user._count.trades)} />
          <StatBox
            label="Open positions"
            value={`${fmtCoins(user._count.positions)} · ${fmtCoins(Math.round(positionValue - positionCost))} P/L`}
            tone={positionValue - positionCost >= 0 ? "yes" : "no"}
          />
          <StatBox
            label="Withdrawals"
            value={fmtCoins(user._count.withdrawals)}
          />
        </div>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Coin flow by source</CardTitle>
            <span className="text-xs text-slate-500">
              {txByKind.length} kinds
            </span>
          </CardHeader>
          {txByKind.length === 0 ? (
            <p className="py-3 text-sm text-slate-500">No transactions yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-2">Kind</th>
                  <th className="py-2 text-right">Count</th>
                  <th className="py-2 text-right">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {txByKind.map((row) => (
                  <tr key={row.kind}>
                    <td className="py-2 font-mono">{row.kind}</td>
                    <td className="py-2 text-right font-mono">
                      {fmtCoins(row._count._all)}
                    </td>
                    <td
                      className={`py-2 text-right font-mono ${
                        (row._sum.delta ?? 0) >= 0 ? "ticker-up" : "ticker-down"
                      }`}
                    >
                      {(row._sum.delta ?? 0) >= 0 ? "+" : ""}
                      {fmtCoins(row._sum.delta ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Recent ledger</CardTitle>
              <span className="text-xs text-slate-500">last 40</span>
            </CardHeader>
            <ul className="max-h-96 divide-y divide-slate-800 overflow-y-auto">
              {recentTxns.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <div>
                    <div className="font-mono text-xs text-slate-300">
                      {t.kind}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {timeAgo(t.createdAt)}
                    </div>
                  </div>
                  <div
                    className={`font-mono ${
                      t.delta >= 0 ? "ticker-up" : "ticker-down"
                    }`}
                  >
                    {t.delta >= 0 ? "+" : ""}
                    {fmtCoins(t.delta)}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent trades</CardTitle>
              <span className="text-xs text-slate-500">{trades.length}</span>
            </CardHeader>
            <ul className="max-h-96 divide-y divide-slate-800 overflow-y-auto">
              {trades.map((t) => (
                <li
                  key={t.id}
                  className="py-2 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <Link
                      href={`/markets/${t.market.slug}`}
                      className="line-clamp-1 hover:text-slate-100"
                    >
                      <Badge
                        tone={t.outcome === "YES" ? "yes" : "no"}
                        className="mr-1"
                      >
                        {t.outcome}
                      </Badge>
                      {t.market.title}
                    </Link>
                    <span
                      className={`font-mono text-xs ${
                        t.cost > 0 ? "ticker-down" : "ticker-up"
                      }`}
                    >
                      {t.cost > 0 ? "−" : "+"}
                      {fmtCoins(Math.abs(t.cost))}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {t.shares.toFixed(2)} sh @ {fmtPrice(t.pricePerShare)} ·{" "}
                    {timeAgo(t.createdAt)}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Withdrawals history</CardTitle>
            <span className="text-xs text-slate-500">{withdrawals.length}</span>
          </CardHeader>
          {withdrawals.length === 0 ? (
            <p className="py-3 text-sm text-slate-500">No withdrawals yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-2">Amount</th>
                  <th className="py-2">Method</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">IP</th>
                  <th className="py-2">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {withdrawals.map((w) => (
                  <tr key={w.id}>
                    <td className="py-2 font-mono">
                      ₹{fmtCoins(w.amountCoins)}
                    </td>
                    <td className="py-2">
                      <Badge>{w.payoutMethod}</Badge>
                    </td>
                    <td className="py-2">
                      <Badge
                        tone={
                          w.status === "PAID"
                            ? "yes"
                            : w.status === "REJECTED"
                              ? "no"
                              : w.status === "PENDING"
                                ? "warn"
                                : w.status === "APPROVED"
                                  ? "info"
                                  : "default"
                        }
                      >
                        {w.status}
                      </Badge>
                    </td>
                    <td className="py-2 font-mono text-xs text-slate-400">
                      {w.ipAddress ?? "—"}
                    </td>
                    <td className="py-2 text-xs text-slate-500">
                      {timeAgo(w.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {ipMatches.length > 0 && (
            <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
              <strong>IP overlap</strong> — other users have withdrawn from the
              same IP(s):{" "}
              {ipMatches
                .map((w) => (
                  <Link
                    key={w.id}
                    href={`/admin/users/${w.user.id}/audit`}
                    className="underline hover:text-amber-100"
                  >
                    {w.user.username}
                  </Link>
                ))
                .reduce<React.ReactNode[]>(
                  (acc, el, i) => (i === 0 ? [el] : [...acc, ", ", el]),
                  [],
                )}
              . Investigate before approving.
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}

function StatBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "yes" | "no" | "info";
}) {
  const cls =
    tone === "yes"
      ? "ticker-up"
      : tone === "no"
        ? "ticker-down"
        : tone === "info"
          ? "text-cyan-300"
          : "text-slate-100";
  return (
    <div className="glass rounded-xl p-4">
      <div className={`text-xl font-black ${cls}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </div>
    </div>
  );
}
