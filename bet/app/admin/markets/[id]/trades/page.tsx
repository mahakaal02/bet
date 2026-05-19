import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { db } from "@/lib/db";
import { fmtCoins } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

/**
 * Per-market trade log. Cursor-paginated against `(createdAt, id)` so
 * the table is stable as new trades land in real time. For each fill
 * we show: time, user (linkable to their audit page), side, shares,
 * price, fee, and the post-trade AMM reserves so an admin can replay
 * the price impact without reconstructing the matcher.
 *
 * Filters: outcome (YES / NO / both), and an optional `before=<id>`
 * cursor for paging deeper than the most-recent page.
 */
export default async function MarketTradesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const outcomeParam = sp.outcome === "YES" || sp.outcome === "NO" ? sp.outcome : null;
  const before = typeof sp.before === "string" ? sp.before : null;

  const market = await db.market.findUnique({
    where: { id },
    select: { id: true, title: true },
  });
  if (!market) notFound();

  // Cursor decoding: take the row at `before` (if any) and find trades
  // strictly older. We use timestamp pagination because the timestamp
  // is the user-facing chronology — `id` ordering would be opaque.
  let beforeCreatedAt: Date | undefined;
  if (before) {
    const ref = await db.trade.findUnique({
      where: { id: before },
      select: { createdAt: true },
    });
    if (ref) beforeCreatedAt = ref.createdAt;
  }

  const trades = await db.trade.findMany({
    where: {
      marketId: id,
      ...(outcomeParam ? { outcome: outcomeParam } : {}),
      ...(beforeCreatedAt ? { createdAt: { lt: beforeCreatedAt } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
    include: { user: { select: { id: true, username: true } } },
  });

  // Aggregate stats for the current filter view (cheap COUNT + SUM).
  const [allCount, agg] = await Promise.all([
    db.trade.count({
      where: {
        marketId: id,
        ...(outcomeParam ? { outcome: outcomeParam } : {}),
      },
    }),
    db.trade.aggregate({
      where: {
        marketId: id,
        ...(outcomeParam ? { outcome: outcomeParam } : {}),
      },
      _sum: { feeCoins: true, shares: true },
    }),
  ]);

  const nextCursor =
    trades.length === PAGE_SIZE ? trades[trades.length - 1].id : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <FilterChip
            href={`/admin/markets/${id}/trades`}
            active={!outcomeParam}
            label={`All (${allCount})`}
          />
          <FilterChip
            href={`/admin/markets/${id}/trades?outcome=YES`}
            active={outcomeParam === "YES"}
            label="YES"
          />
          <FilterChip
            href={`/admin/markets/${id}/trades?outcome=NO`}
            active={outcomeParam === "NO"}
            label="NO"
          />
        </div>
        <div className="text-xs text-slate-500">
          {(agg._sum.shares ?? 0).toFixed(2)} shares traded ·{" "}
          {fmtCoins(agg._sum.feeCoins ?? 0)} fees collected
        </div>
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/60 text-[10px] font-bold uppercase tracking-widest text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-bold">Time</th>
              <th className="px-3 py-2 text-left font-bold">User</th>
              <th className="px-3 py-2 text-left font-bold">Outcome</th>
              <th className="px-3 py-2 text-right font-bold">Shares</th>
              <th className="px-3 py-2 text-right font-bold">Price</th>
              <th className="px-3 py-2 text-right font-bold">Net coins</th>
              <th className="px-3 py-2 text-right font-bold">Fee</th>
              <th className="px-3 py-2 text-right font-bold">Reserves after</th>
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                  No trades match this filter.
                </td>
              </tr>
            ) : (
              trades.map((t) => (
                <tr key={t.id} className="border-t border-slate-800/60">
                  <td className="px-3 py-2 text-xs text-slate-400">
                    {t.createdAt.toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/users/${t.userId}/audit`}
                      className="text-cyan-300 hover:underline"
                    >
                      @{t.user.username}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={t.outcome === "YES" ? "yes" : "no"}>
                      {t.outcome}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {t.shares.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {t.pricePerShare.toFixed(3)}
                  </td>
                  <td
                    className={
                      "px-3 py-2 text-right font-mono " +
                      (t.cost > 0 ? "text-rose-300" : "text-emerald-300")
                    }
                  >
                    {t.cost > 0 ? `−${fmtCoins(t.cost)}` : `+${fmtCoins(-t.cost)}`}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-400">
                    {fmtCoins(t.feeCoins)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[10px] text-slate-500">
                    Y {t.yesSharesAfter.toFixed(0)} · N{" "}
                    {t.noSharesAfter.toFixed(0)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      {nextCursor && (
        <div className="flex justify-end">
          <Link
            href={
              outcomeParam
                ? `/admin/markets/${id}/trades?outcome=${outcomeParam}&before=${nextCursor}`
                : `/admin/markets/${id}/trades?before=${nextCursor}`
            }
            className="text-xs font-semibold text-cyan-300 hover:underline"
          >
            Older trades →
          </Link>
        </div>
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
