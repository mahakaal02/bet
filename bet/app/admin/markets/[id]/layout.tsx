import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { MarketTabs } from "@/components/MarketAdminTabs";
import { db } from "@/lib/db";
import { fmtCoins } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Shared chrome for every page under `/admin/markets/<id>/*`.
 *
 * Renders the market header (title, status, category, summary counts)
 * plus a tab strip pointing at the four sub-surfaces: Overview /
 * Order book / Trades / Positions. Each child page handles its own
 * data fetch — this layout only owns the orientation chrome.
 */
export default async function MarketAdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const market = await db.market.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      category: true,
      status: true,
      resolvedAs: true,
      volumeCoins: true,
      _count: { select: { trades: true, positions: true, orders: true } },
    },
  });
  if (!market) notFound();

  return (
    <div className="py-6">
      <div className="mb-3 flex items-center gap-2">
        <Link
          href="/admin"
          className="text-xs text-slate-400 hover:text-slate-200"
        >
          ← Admin
        </Link>
        <span className="text-slate-700">/</span>
        <Badge>{market.category}</Badge>
        <Badge
          tone={
            market.status === "OPEN"
              ? "info"
              : market.status === "RESOLVED"
                ? market.resolvedAs === "YES"
                  ? "yes"
                  : "no"
                : market.status === "CANCELLED"
                  ? "warn"
                  : "default"
          }
        >
          {market.status}
          {market.status === "RESOLVED" && market.resolvedAs && ` · ${market.resolvedAs}`}
        </Badge>
      </div>
      <h1 className="text-2xl font-black leading-tight">{market.title}</h1>
      <p className="mt-1 text-xs text-slate-500">
        {market._count.trades} trades · {market._count.positions} positions ·{" "}
        {market._count.orders} orders ·{" "}
        <span className="font-mono">{fmtCoins(market.volumeCoins)}</span> volume
      </p>

      <MarketTabs marketId={id} />

      <div className="mt-5">{children}</div>
    </div>
  );
}
