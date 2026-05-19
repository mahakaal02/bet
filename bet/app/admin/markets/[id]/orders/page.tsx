import { notFound } from "next/navigation";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CancelOrderButton } from "@/components/CancelOrderButton";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type OpenOrderRow = {
  id: string;
  limitPrice: number;
  remaining: number;
  filledShares: number;
  status: string;
  createdAt: Date;
  user: { id: string; username: string };
};

/**
 * Per-market order-book inspector. Two side-by-side ledgers (YES + NO)
 * each split into BUY and SELL columns. Within each column orders sort
 * by price-time priority — the same priority the matcher uses — so a
 * top-row "OPEN" BUY @ 0.55 is genuinely the next-to-fill on that book.
 *
 * For each open order we surface the placing user, time, price, and
 * remaining size, plus a Force-cancel action. Force-cancel hits a
 * server endpoint that runs the same atomic refund-and-cancel logic
 * the user-facing DELETE does, plus an AdminLog entry. FILLED /
 * CANCELLED orders are excluded from the ledger by default.
 */
export default async function MarketOrderbookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const market = await db.market.findUnique({
    where: { id },
    select: { id: true, title: true, status: true },
  });
  if (!market) notFound();

  const openOrders = await db.order.findMany({
    where: { marketId: id, status: { in: ["OPEN", "PARTIAL"] } },
    include: { user: { select: { id: true, username: true } } },
  });

  // Matcher-priority sort: BUYs descending by price, SELLs ascending.
  // Ties break on createdAt ascending (older order is ahead in line).
  function sortBook(side: "BUY" | "SELL") {
    return (a: (typeof openOrders)[number], b: (typeof openOrders)[number]) => {
      if (a.limitPrice !== b.limitPrice) {
        return side === "BUY"
          ? b.limitPrice - a.limitPrice
          : a.limitPrice - b.limitPrice;
      }
      return a.createdAt.getTime() - b.createdAt.getTime();
    };
  }

  const yesBuys = openOrders
    .filter((o) => o.outcome === "YES" && o.side === "BUY")
    .sort(sortBook("BUY"));
  const yesSells = openOrders
    .filter((o) => o.outcome === "YES" && o.side === "SELL")
    .sort(sortBook("SELL"));
  const noBuys = openOrders
    .filter((o) => o.outcome === "NO" && o.side === "BUY")
    .sort(sortBook("BUY"));
  const noSells = openOrders
    .filter((o) => o.outcome === "NO" && o.side === "SELL")
    .sort(sortBook("SELL"));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <BookCard
          title="YES"
          tone="yes"
          buys={yesBuys}
          sells={yesSells}
          marketResolved={market.status !== "OPEN"}
        />
        <BookCard
          title="NO"
          tone="no"
          buys={noBuys}
          sells={noSells}
          marketResolved={market.status !== "OPEN"}
        />
      </div>

      {openOrders.length === 0 && (
        <p className="text-sm text-slate-500">
          No open orders on this market.
        </p>
      )}
    </div>
  );
}

function BookCard({
  title,
  tone,
  buys,
  sells,
  marketResolved,
}: {
  title: string;
  tone: "yes" | "no";
  buys: OpenOrderRow[];
  sells: OpenOrderRow[];
  marketResolved: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>
          <Badge tone={tone}>{title}</Badge>{" "}
          <span className="ml-2 text-sm text-slate-400">
            {buys.length} buys · {sells.length} sells
          </span>
        </CardTitle>
      </CardHeader>
      <div className="grid grid-cols-2 gap-3">
        <BookColumn label="Buys" rows={buys} marketResolved={marketResolved} />
        <BookColumn label="Sells" rows={sells} marketResolved={marketResolved} />
      </div>
    </Card>
  );
}

function BookColumn({
  label,
  rows,
  marketResolved,
}: {
  label: string;
  rows: OpenOrderRow[];
  marketResolved: boolean;
}) {
  return (
    <div>
      <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
        {label}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-600">—</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((o) => (
            <li
              key={o.id}
              className="rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm">
                  {o.limitPrice.toFixed(2)} × {o.remaining}
                </span>
                <CancelOrderButton
                  orderId={o.id}
                  disabled={marketResolved}
                  tinyVariant
                />
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[10px] text-slate-500">
                <span>@{o.user.username}</span>
                <span>{new Date(o.createdAt).toLocaleString()}</span>
              </div>
              {o.status === "PARTIAL" && (
                <div className="mt-0.5 text-[10px] text-amber-400">
                  partial · {o.filledShares.toFixed(2)} filled
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

