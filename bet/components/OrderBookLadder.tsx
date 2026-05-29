"use client";

import { useEffect, useMemo } from "react";
import useSWR from "swr";
import { useMarketStream } from "@/lib/useMarketStream";
import { cn, fmtCoins, fmtPrice } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/client";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Row {
  price: number;
  shares: number;
}

interface Side {
  bids: Row[];
  asks: Row[];
  bestBid: number | null;
  bestAsk: number | null;
}

interface Resp {
  yes: Side;
  no: Side;
}

/**
 * 5-deep YES ladder. Bids on the left (descending), asks on the right
 * (ascending). The taker, by convention in prediction markets, buys YES from
 * the ASK side and sells YES to the BID side.
 *
 * Auto-refreshes when the parent `marketStreamKey` SSE pushes a "book"
 * event — we just call `mutate()` on the SWR cache to re-fetch.
 */
export function OrderBookLadder({
  marketId,
  outcome,
}: {
  marketId: string;
  outcome: "YES" | "NO";
}) {
  const { locale } = useTranslation();
  const { data, mutate } = useSWR<Resp>(
    `/api/markets/${marketId}/orderbook`,
    fetcher,
    { refreshInterval: 0, revalidateOnFocus: true },
  );

  // Re-fetch the book whenever the market stream tells us it changed.
  const tick = useMarketStream(marketId);
  useEffect(() => {
    if (!tick) return;
    // Both "trade" and "book" events should invalidate. Snapshots don't.
    void mutate();
  }, [tick?.at, mutate]);

  const side = data?.[outcome === "YES" ? "yes" : "no"];

  const spread =
    side && side.bestAsk !== null && side.bestBid !== null
      ? side.bestAsk - side.bestBid
      : null;

  // Render up to 5 levels per side; pad with empty rows so the ladder
  // doesn't reflow as orders come and go.
  const bids = useMemo(() => fixedDepth(side?.bids ?? [], 5), [side?.bids]);
  const asks = useMemo(() => fixedDepth(side?.asks ?? [], 5), [side?.asks]);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2 text-xs">
        <span className="font-semibold uppercase tracking-wider text-slate-400">
          Orderbook · {outcome}
        </span>
        <span className="font-mono text-slate-500">
          spread {spread !== null ? fmtPrice(spread, 2, locale) : "—"}
        </span>
      </div>
      <div className="grid grid-cols-2 divide-x divide-slate-800">
        {/* Bids */}
        <Column rows={bids} kind="bid" />
        {/* Asks */}
        <Column rows={asks} kind="ask" />
      </div>
    </div>
  );
}

function Column({ rows, kind }: { rows: Row[]; kind: "bid" | "ask" }) {
  const { locale } = useTranslation();
  const isBid = kind === "bid";
  const maxSize = Math.max(1, ...rows.map((r) => r.shares));
  return (
    <div>
      <div
        className={cn(
          "flex justify-between px-2 py-1 text-[10px] font-mono uppercase text-slate-500",
          isBid ? "text-emerald-500/70" : "text-rose-500/70",
        )}
      >
        <span>{isBid ? "Bid" : "Ask"}</span>
        <span>Size</span>
      </div>
      {rows.map((r, i) => {
        const bar = (r.shares / maxSize) * 100;
        const empty = r.shares === 0;
        return (
          <div
            key={i}
            className="relative flex items-center justify-between px-2 py-1 text-xs font-mono"
          >
            <div
              className={cn(
                "absolute inset-y-0",
                isBid ? "end-0 bg-emerald-500/10" : "start-0 bg-rose-500/10",
                empty && "bg-transparent",
              )}
              style={{ width: empty ? 0 : `${bar}%` }}
              aria-hidden
            />
            <span
              className={cn(
                "relative z-10",
                empty
                  ? "text-slate-700"
                  : isBid
                    ? "text-emerald-300"
                    : "text-rose-300",
              )}
            >
              {empty ? "—" : fmtPrice(r.price, 2, locale)}
            </span>
            <span
              className={cn(
                "relative z-10",
                empty ? "text-slate-700" : "text-slate-300",
              )}
            >
              {empty ? "—" : fmtCoins(Math.round(r.shares), locale)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function fixedDepth(rows: Row[], n: number): Row[] {
  const out = rows.slice(0, n);
  while (out.length < n) out.push({ price: 0, shares: 0 });
  return out;
}
