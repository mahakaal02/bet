import Link from "next/link";
import {
  db } from "@/lib/db";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  SectionTitle,
} from "@/components/admin/ui/primitives";
import { fmtCoins, fmtDate } from "@/components/admin/ui/format";
import { IconOrderBook } from "@/components/admin/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Cross-market order book (PR-BET-ADMIN-REDESIGN).
 *
 * Server-rendered list of every OPEN / PARTIAL order across all
 * markets. Filtered + sorted by created-desc, capped at 200 rows
 * for the initial paint — the existing market-detail page
 * (`/admin/markets/[id]/orders`) is still the right surface for
 * deep dives. This view is the "what's live across the platform"
 * eagle-eye.
 *
 * Force-cancel + freeze actions are routed through the existing
 * `DELETE /api/admin/orders/[id]` endpoint already in the codebase.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; side?: string }>;
}) {
  const sp = await searchParams;
  const statusFilter = sp.status === "all" ? undefined : ["OPEN", "PARTIAL"];

  const orders = await db.order.findMany({
    where: {
      ...(statusFilter ? { status: { in: statusFilter as never } } : {}),
      ...(sp.side ? { side: sp.side as never } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      user: { select: { username: true } },
      market: { select: { id: true, title: true, slug: true } },
    },
  });

  const totalLocked = orders.reduce(
    (acc, o) => acc + o.remaining * Number(o.limitPrice ?? 0),
    0,
  );

  return (
    <>
      <PageHeader
        kicker="Markets"
        title="Order book"
        description="Cross-market live orders. Force-cancel from any row; deep-dive into per-market depth from each market page."
        actions={
          <Link
            href="/admin/markets"
            className="inline-flex h-9 items-center rounded-lg border border-[var(--admin-border)] bg-[var(--admin-elevated)] px-3.5 text-sm text-[var(--admin-text-secondary)] hover:bg-[var(--admin-elevated-hi)]"
          >
            All markets →
          </Link>
        }
      />

      <Card className="mb-4 grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--admin-text-muted)]">
            Open orders
          </div>
          <div className="mt-1 font-mono text-xl font-black tabular-nums text-[var(--admin-text-primary)]">
            {orders.length.toLocaleString("en-IN")}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--admin-text-muted)]">
            Locked value
          </div>
          <div className="mt-1 font-mono text-xl font-black tabular-nums text-[var(--admin-text-primary)]">
            {fmtCoins(Math.round(totalLocked))}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--admin-text-muted)]">
            YES side
          </div>
          <div className="mt-1 font-mono text-xl font-black tabular-nums text-emerald-300">
            {orders.filter((o) => o.outcome === "YES").length}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--admin-text-muted)]">
            NO side
          </div>
          <div className="mt-1 font-mono text-xl font-black tabular-nums text-rose-300">
            {orders.filter((o) => o.outcome === "NO").length}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-[var(--admin-text-muted)]">
            <tr>
              <th className="px-3 py-2 text-left">Market</th>
              <th className="px-3 py-2 text-left">User</th>
              <th className="px-3 py-2 text-left">Side</th>
              <th className="px-3 py-2 text-right">Limit</th>
              <th className="px-3 py-2 text-right">Remaining</th>
              <th className="px-3 py-2 text-right">Reserved</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">Placed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-divider)]">
            {orders.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <EmptyState
                    icon={<IconOrderBook size={18} />}
                    title="No open orders"
                    description="The order book is clear. Healthy markets fill quickly."
                  />
                </td>
              </tr>
            )}
            {orders.map((o) => (
              <tr key={o.id} className="text-[var(--admin-text-primary)] transition hover:bg-[var(--admin-elevated)]">
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/markets/${o.market.id}/orders`}
                    className="block max-w-[28ch] truncate font-semibold hover:text-cyan-300"
                  >
                    {o.market.title}
                  </Link>
                </td>
                <td className="px-3 py-2 text-xs">@{o.user.username}</td>
                <td className="px-3 py-2">
                  <Badge tone={o.outcome === "YES" ? "success" : "danger"} dot>
                    {o.side} {o.outcome}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {Number(o.limitPrice).toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {Math.round(o.remaining)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {fmtCoins(Math.round(o.remaining * Number(o.limitPrice)))}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={o.status === "OPEN" ? "info" : "warning"}>
                    {o.status}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-right text-[11px] text-[var(--admin-text-secondary)]">
                  {fmtDate(o.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="mt-4 text-[11px] text-[var(--admin-text-muted)]">
        Force-cancel an order from its market detail page → Orders tab. The
        existing <code>DELETE /api/admin/orders/[id]</code> endpoint
        refunds the reservation atomically.
      </p>
    </>
  );
}
