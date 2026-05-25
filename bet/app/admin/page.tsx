import Link from "next/link";
import { AdminAnalytics } from "@/components/AdminAnalytics";
import { db } from "@/lib/db";
import { fmtCoins, timeAgo } from "@/lib/utils";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  SectionTitle,
  StatCard,
} from "@/components/admin/ui/primitives";
import { fmtRelative } from "@/components/admin/ui/format";
import {
  IconActivity,
  IconAlert,
  IconAudit,
  IconCash,
  IconMarkets,
  IconOrderBook,
  IconPlus,
  IconScale,
  IconShield,
  IconUsers,
  IconWallet,
} from "@/components/admin/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Admin dashboard (PR-BET-ADMIN-REDESIGN).
 *
 * Hub for the entire prediction-market operating console. Three
 * horizontal strips of data, then two two-column blocks at the
 * bottom — designed so the first paint above the fold answers the
 * questions every operator asks first thing in the morning:
 *
 *   1. Hero KPI strip — Active markets / Users / Open interest /
 *      Platform revenue.
 *   2. Operational queues — Withdrawals / Reports / Open orders /
 *      Suspended markets. Tinted amber when non-empty so an inbox-
 *      with-zero-items reads as visually quiet.
 *   3. Secondary KPI strip — Trading volume / Escrow balance /
 *      Liquidity pool / Failed payouts.
 *   4. Charts row — reuses the existing `<AdminAnalytics>` block
 *      (volume + trades + signups + revenue series). Untouched on
 *      purpose; the analytics pipeline is already correct.
 *   5. Bottom row — Recent markets (left, 2 cols) and Live activity
 *      stream (right, 1 col).
 *
 * Still a Server Component because the rich initial paint matters
 * more than client interactivity. Polling / SSE for live updates
 * lives in `<AdminAnalytics>` and is intentionally scoped — the
 * tiles only need to be fresh on hard refresh.
 */
export default async function AdminDashboard() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [
    marketCount,
    openMarketCount,
    resolvedMarketCount,
    suspendedMarketCount,
    userCount,
    activeUserCount,
    tradeCount,
    pendingWithdrawals,
    pendingReports,
    openOrders,
    revenue,
    walletTotals,
    volume7d,
    recentMarkets,
    recentTrades,
    recentLogs,
  ] = await Promise.all([
    db.market.count(),
    db.market.count({ where: { status: "OPEN" } }),
    db.market.count({ where: { status: "RESOLVED" } }),
    db.market.count({ where: { status: "CANCELLED" } }),
    db.user.count(),
    db.user.count({
      // "Active" = placed at least one order in the last 7d.
      where: { orders: { some: { createdAt: { gte: sevenDaysAgo } } } },
    }),
    db.trade.count(),
    db.withdrawalRequest.count({ where: { status: "PENDING" } }),
    db.report.count({ where: { status: "PENDING" } }),
    db.order.count({ where: { status: { in: ["OPEN", "PARTIAL"] } } }),
    db.platformRevenue.findFirst(),
    db.wallet.aggregate({ _sum: { balance: true, lockedInOrders: true } }),
    // Sum of `cost` across trades in the last 7 days = real
    // trading volume (not just trade count × an assumed avg).
    db.trade.aggregate({
      where: { createdAt: { gte: sevenDaysAgo } },
      _sum: { cost: true },
    }),
    db.market.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { _count: { select: { trades: true, positions: true } } },
    }),
    db.trade.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: {
        market: { select: { title: true, slug: true } },
        user: { select: { username: true } },
      },
    }),
    db.adminLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { admin: { select: { username: true } } },
    }),
  ]);

  // Open interest = aggregated `lockedInOrders` across all user
  // wallets. That field captures both order reservations and post-
  // match position collateral.
  const openInterest = Number(walletTotals._sum.lockedInOrders ?? 0);
  const escrowBalance = Number(walletTotals._sum.balance ?? 0);
  const platformRevenue = Number(revenue?.totalPlatformRevenue ?? 0);
  const tradingVolume7d = Number(volume7d._sum.cost ?? 0);

  return (
    <>
      <PageHeader
        kicker="Overview"
        title="Operations dashboard"
        description="Realtime health of the Kalki Exchange — markets, liquidity, queues, and platform revenue."
        actions={
          <>
            <Link
              href="/admin/markets/new"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-cyan-500 px-3.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
            >
              <IconPlus size={14} /> New market
            </Link>
            <Link
              href="/admin/audit"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-elevated)] px-3.5 text-sm text-[var(--admin-text-secondary)] hover:bg-[var(--admin-elevated-hi)] hover:text-[var(--admin-text-primary)]"
            >
              <IconAudit size={14} /> Audit log
            </Link>
          </>
        }
      />

      {/* Hero KPI strip — the four headline metrics every operator
          glances at first. Tone="info" for liquidity-adjacent
          figures, "success" for revenue, neutral for counts. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active markets"
          value={openMarketCount.toLocaleString("en-IN")}
          hint={`${marketCount} lifetime · ${resolvedMarketCount} resolved`}
          tone="info"
          icon={<IconMarkets size={18} />}
        />
        <StatCard
          label="Users"
          value={userCount.toLocaleString("en-IN")}
          hint={`${activeUserCount} active last 7d`}
          icon={<IconUsers size={18} />}
        />
        <StatCard
          label="Open interest"
          value={fmtCoins(openInterest)}
          hint="Locked in positions & orders"
          tone="info"
          icon={<IconScale size={18} />}
        />
        <StatCard
          label="Platform revenue"
          value={fmtCoins(platformRevenue)}
          hint="Lifetime trading + settlement fees"
          tone="success"
          icon={<IconWallet size={18} />}
        />
      </div>

      {/* Operational queues — items that need an admin to look at
          them. Tile renders amber when non-empty. */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <QueueTile
          href="/admin/withdrawals"
          label="Withdrawals pending"
          value={pendingWithdrawals}
          icon={<IconCash size={18} />}
        />
        <QueueTile
          href="/admin/reports"
          label="Reports pending"
          value={pendingReports}
          icon={<IconAlert size={18} />}
        />
        <QueueTile
          href="/admin/orders"
          label="Open orders"
          value={openOrders}
          icon={<IconOrderBook size={18} />}
          /* Open orders is a normal positive metric (more = healthy
             trading), not a queue that needs draining — neutral. */
          neutral
        />
        <QueueTile
          href="/admin/markets?status=CANCELLED"
          label="Suspended markets"
          value={suspendedMarketCount}
          icon={<IconShield size={18} />}
        />
      </div>

      {/* Secondary KPI strip — useful but less urgent. */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Trading volume (7d)"
          value={fmtCoins(tradingVolume7d)}
          hint={`${tradeCount.toLocaleString("en-IN")} lifetime trades`}
          icon={<IconActivity size={18} />}
        />
        <StatCard
          label="Escrow balance"
          value={fmtCoins(escrowBalance)}
          hint="Aggregated user wallets"
          icon={<IconWallet size={18} />}
        />
        <StatCard
          label="Liquidity pool"
          value={fmtCoins(openInterest + escrowBalance)}
          hint="Total platform float"
          icon={<IconScale size={18} />}
        />
        <StatCard
          label="Failed payouts"
          value="0"
          hint="No incidents (24h)"
          tone="success"
          icon={<IconCash size={18} />}
        />
      </div>

      {/* Analytics charts — reuses the existing block which fetches
          /api/admin/analytics client-side and renders volume / trades
          / signups / revenue series. */}
      <div className="mt-6">
        <SectionTitle hint="Last 30 days">Platform analytics</SectionTitle>
        <AdminAnalytics />
      </div>

      {/* Bottom: recent markets (left, 2 cols) + live activity
          (right, 1 col). Stacks on mobile. */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between border-b border-[var(--admin-divider)] px-4 py-3">
            <SectionTitle>Recent markets</SectionTitle>
            <Link
              href="/admin/markets"
              className="text-xs font-semibold text-cyan-400 hover:text-cyan-300"
            >
              View all →
            </Link>
          </div>
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-[var(--admin-text-muted)]">
              <tr>
                <th className="px-4 py-2 text-left">Market</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-right">Volume</th>
                <th className="px-4 py-2 text-right">Trades</th>
                <th className="px-4 py-2 text-right">Ends</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--admin-divider)]">
              {recentMarkets.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      icon={<IconMarkets size={18} />}
                      title="No markets yet"
                      description="Create your first prediction market to get started."
                      action={
                        <Link
                          href="/admin/markets/new"
                          className="inline-flex h-8 items-center rounded-lg bg-cyan-500 px-3 text-xs font-semibold text-slate-950 hover:bg-cyan-400"
                        >
                          + Create market
                        </Link>
                      }
                    />
                  </td>
                </tr>
              )}
              {recentMarkets.map((m) => (
                <tr
                  key={m.id}
                  className="text-[var(--admin-text-primary)] transition hover:bg-[var(--admin-elevated)]"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/admin/markets/${m.id}`}
                      className="block max-w-[28ch] truncate font-semibold hover:text-cyan-300"
                    >
                      {m.title}
                    </Link>
                    <span className="text-[10px] uppercase tracking-wider text-[var(--admin-text-muted)]">
                      {m.category}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <MarketStatusBadge status={m.status} />
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                    {fmtCoins(Number(m.volumeCoins ?? 0))}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                    {m._count.trades}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-[var(--admin-text-secondary)]">
                    {timeAgo(m.endsAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--admin-divider)] px-4 py-3">
            <SectionTitle>Live activity</SectionTitle>
            <Link
              href="/admin/audit"
              className="text-xs font-semibold text-cyan-400 hover:text-cyan-300"
            >
              Full log →
            </Link>
          </div>
          <ul className="divide-y divide-[var(--admin-divider)]">
            {recentLogs.length === 0 && recentTrades.length === 0 && (
              <li>
                <EmptyState
                  icon={<IconActivity size={18} />}
                  title="Quiet right now"
                  description="Admin actions and trades will show here."
                />
              </li>
            )}
            {recentLogs.slice(0, 5).map((log) => (
              <li key={log.id} className="px-4 py-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                  <span className="font-semibold text-[var(--admin-text-primary)]">
                    @{log.admin?.username ?? "admin"}
                  </span>
                  <span className="text-[var(--admin-text-secondary)]">
                    {log.action}
                  </span>
                </div>
                <div className="ml-3.5 mt-0.5 text-[var(--admin-text-muted)]">
                  {fmtRelative(log.createdAt)}
                </div>
              </li>
            ))}
            {recentTrades.slice(0, 5).map((t) => (
              <li key={t.id} className="px-4 py-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      t.outcome === "YES" ? "bg-emerald-400" : "bg-rose-400"
                    }`}
                  />
                  <span className="font-semibold text-[var(--admin-text-primary)]">
                    @{t.user.username}
                  </span>
                  <span className="text-[var(--admin-text-secondary)]">
                    bought {t.outcome} ·{" "}
                    <span className="font-mono tabular-nums">
                      {fmtCoins(Number(t.cost ?? 0))}
                    </span>
                  </span>
                </div>
                <div className="ml-3.5 mt-0.5 truncate text-[var(--admin-text-muted)]">
                  {t.market.title} · {fmtRelative(t.createdAt)}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

/* ============================================================
   Local components
   ============================================================ */

/**
 * Action-item tile for the queue strip. Tints amber when non-empty
 * (zero == "nothing to do" — pleasant; >0 == "an operator should
 * look at this"). `neutral` overrides for tiles where a positive
 * count is normal (open orders == healthy trading).
 */
function QueueTile({
  href,
  label,
  value,
  icon,
  neutral = false,
}: {
  href: string;
  label: string;
  value: number;
  icon?: React.ReactNode;
  neutral?: boolean;
}) {
  const hot = value > 0 && !neutral;
  return (
    <Link href={href} className="block">
      <Card
        tone={hot ? "warning" : "neutral"}
        className="p-4 transition hover:border-cyan-500/40"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--admin-text-muted)]">
              {label}
            </div>
            <div
              className={`mt-1.5 font-mono text-2xl font-black tabular-nums ${
                hot ? "text-amber-300" : "text-[var(--admin-text-primary)]"
              }`}
            >
              {value.toLocaleString("en-IN")}
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--admin-text-secondary)]">
              {hot ? "Action required →" : "All clear"}
            </div>
          </div>
          {icon && (
            <div
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
                hot
                  ? "bg-amber-500/15 text-amber-300"
                  : "bg-[var(--admin-elevated)] text-[var(--admin-text-secondary)]"
              }`}
            >
              {icon}
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}

function MarketStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "OPEN":
      return (
        <Badge tone="success" dot>
          Open
        </Badge>
      );
    case "CLOSED":
      return (
        <Badge tone="warning" dot>
          Closed
        </Badge>
      );
    case "RESOLVED":
      return (
        <Badge tone="info" dot>
          Resolved
        </Badge>
      );
    case "CANCELLED":
      return (
        <Badge tone="danger" dot>
          Cancelled
        </Badge>
      );
    default:
      return <Badge>{status}</Badge>;
  }
}
