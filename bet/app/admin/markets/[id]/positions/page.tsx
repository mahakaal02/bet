import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { db } from "@/lib/db";
import { fmtCoins } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

/**
 * Per-market open-position view. One row per (user, outcome) pair with
 * a non-zero share balance. Sortable by exposure (cost basis or
 * mark-to-market value at current YES price), filterable by outcome,
 * defaulting to "largest first" so the admin sees concentration at the
 * top — useful both for resolution sanity checks and for spotting
 * single-account whale positions before they cash out.
 *
 * Mark-to-market uses the constant-product AMM's spot price as a
 * conservative valuation. For RESOLVED markets the page renders
 * realized P/L (already snapshotted on Position at resolution time)
 * instead of MTM.
 */
export default async function MarketPositionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const outcomeParam = sp.outcome === "YES" || sp.outcome === "NO" ? sp.outcome : null;

  const market = await db.market.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      yesShares: true,
      noShares: true,
      resolvedAs: true,
    },
  });
  if (!market) notFound();

  // Constant-product spot prices. Same math the trade screen uses; we
  // keep it local so this view is independent of the AMM lib's import
  // shape changes.
  const total = market.yesShares + market.noShares;
  const yesPrice = total > 0 ? market.noShares / total : 0.5;
  const noPrice = total > 0 ? market.yesShares / total : 0.5;

  const positions = await db.position.findMany({
    where: {
      marketId: id,
      ...(outcomeParam ? { outcome: outcomeParam } : {}),
      shares: { gt: 0 },
    },
    orderBy: { shares: "desc" },
    take: PAGE_SIZE,
    include: { user: { select: { id: true, username: true } } },
  });

  const open = market.status === "OPEN";
  const totalShares = positions.reduce((acc, p) => acc + p.shares, 0);
  const totalCost = positions.reduce((acc, p) => acc + p.costBasis, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <FilterChip
            href={`/admin/markets/${id}/positions`}
            active={!outcomeParam}
            label="All"
          />
          <FilterChip
            href={`/admin/markets/${id}/positions?outcome=YES`}
            active={outcomeParam === "YES"}
            label="YES only"
          />
          <FilterChip
            href={`/admin/markets/${id}/positions?outcome=NO`}
            active={outcomeParam === "NO"}
            label="NO only"
          />
        </div>
        <div className="text-xs text-slate-500">
          {positions.length} positions on this page · {totalShares.toFixed(2)} shares ·{" "}
          {fmtCoins(totalCost)} cost basis
        </div>
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/60 text-[10px] font-bold uppercase tracking-widest text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-bold">User</th>
              <th className="px-3 py-2 text-left font-bold">Outcome</th>
              <th className="px-3 py-2 text-right font-bold">Shares</th>
              <th className="px-3 py-2 text-right font-bold">Locked</th>
              <th className="px-3 py-2 text-right font-bold">Cost basis</th>
              <th className="px-3 py-2 text-right font-bold">
                {open ? "Mark-to-market" : "Realized P/L"}
              </th>
              <th className="px-3 py-2 text-right font-bold">Unit cost</th>
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  No open positions on this market.
                </td>
              </tr>
            ) : (
              positions.map((p) => {
                const spot = p.outcome === "YES" ? yesPrice : noPrice;
                const mtm = Math.round(p.shares * spot);
                const unitCost = p.shares > 0 ? p.costBasis / p.shares : 0;
                const pnl = open
                  ? mtm - p.costBasis
                  : p.realizedPnl;
                return (
                  <tr key={p.id} className="border-t border-slate-800/60">
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/users/${p.userId}/audit`}
                        className="text-cyan-300 hover:underline"
                      >
                        @{p.user.username}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={p.outcome === "YES" ? "yes" : "no"}>
                        {p.outcome}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {p.shares.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-400">
                      {p.locked > 0 ? p.locked.toFixed(2) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {fmtCoins(p.costBasis)}
                    </td>
                    <td
                      className={
                        "px-3 py-2 text-right font-mono " +
                        (pnl > 0
                          ? "text-emerald-300"
                          : pnl < 0
                            ? "text-rose-300"
                            : "text-slate-400")
                      }
                    >
                      {pnl > 0 ? "+" : ""}
                      {fmtCoins(pnl)}
                      {open && (
                        <span className="ml-1 text-[10px] text-slate-500">
                          @ {spot.toFixed(2)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-400">
                      {unitCost.toFixed(3)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>

      {positions.length === PAGE_SIZE && (
        <p className="text-xs text-slate-500">
          Showing the top {PAGE_SIZE} positions by share size. Refine with the
          outcome filter or open the per-user audit page from any row to see
          full position history.
        </p>
      )}
    </div>
  );
}

function FilterChip({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={
        "rounded-full border px-3 py-1 text-xs font-semibold transition " +
        (active
          ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
          : "border-slate-700 bg-slate-900/60 text-slate-400 hover:bg-slate-800")
      }
    >
      {label}
    </Link>
  );
}
