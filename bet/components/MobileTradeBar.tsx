"use client";

import { useState } from "react";
import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { BottomSheet } from "@/components/BottomSheet";
import { MarketTradePanel } from "@/components/MarketTradePanel";
import { OrderBookLadder } from "@/components/OrderBookLadder";
import { LimitOrderForm } from "@/components/LimitOrderForm";
import { OpenOrdersPanel } from "@/components/OpenOrdersPanel";
import { useMarketStream } from "@/lib/useMarketStream";
import { priceYes } from "@/lib/amm";
import { cn, fmtPrice } from "@/lib/utils";

interface Position {
  outcome: "YES" | "NO";
  shares: number;
  // LimitOrderForm needs `locked` to compute free vs reserved shares; the
  // AMM panel only reads shares + costBasis but accepting the extra field
  // is harmless.
  locked: number;
  costBasis: number;
}

interface Props {
  marketId: string;
  slug: string;
  yesShares: number;
  noShares: number;
  status: "OPEN" | "CLOSED" | "RESOLVED" | "CANCELLED";
  authed: boolean;
  positions: Position[];
}

/**
 * Sticky bottom bar that's only rendered on mobile (the parent applies
 * `md:hidden`). Shows live YES / NO marginal prices and a "Trade" CTA;
 * tapping it slides up the full trade UI as a bottom sheet.
 *
 * The sheet contains everything that lived in the desktop right column —
 * AMM panel, order-book ladder, limit-order form, your-orders list — so
 * mobile users get full parity, not a stripped-down view.
 */
export function MobileTradeBar({
  marketId,
  slug,
  yesShares,
  noShares,
  status,
  authed,
  positions,
}: Props) {
  const [open, setOpen] = useState(false);
  const initialYes = priceYes({ yesShares, noShares });
  const tick = useMarketStream(slug, initialYes);
  const yes = tick?.yesPrice ?? initialYes;
  const tradeOpen = status === "OPEN";

  return (
    <>
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 border-t border-slate-800 bg-slate-950/95 backdrop-blur",
          // iOS safe-area: pad the bottom so the bar doesn't sit under
          // the home indicator.
          "pb-[env(safe-area-inset-bottom)]",
        )}
      >
        <div className="flex items-stretch gap-2 px-3 py-2">
          <div className="flex flex-1 items-center justify-around rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1">
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">
                YES
              </div>
              <div className="text-base font-bold text-emerald-300">
                {fmtPrice(yes)}
              </div>
            </div>
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">
                NO
              </div>
              <div className="text-base font-bold text-rose-300">
                {fmtPrice(1 - yes)}
              </div>
            </div>
          </div>

          {!authed ? (
            <Link
              href={`/login?next=/markets/${slug}`}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 px-4 text-sm font-bold text-slate-950"
            >
              Sign in
            </Link>
          ) : tradeOpen ? (
            <button
              onClick={() => setOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 px-4 text-sm font-bold text-slate-950"
            >
              <TrendingUp className="h-4 w-4" />
              Trade
            </button>
          ) : (
            <button
              disabled
              className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 text-sm font-semibold text-slate-500"
            >
              Closed
            </button>
          )}
        </div>
      </div>

      {/* Spacer so the page can scroll without the bar covering its bottom. */}
      <div
        aria-hidden
        className="h-16 pb-[env(safe-area-inset-bottom)]"
      />

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Trade"
        maxHeightVh={92}
      >
        <div className="space-y-3">
          <MarketTradePanel
            marketId={marketId}
            slug={slug}
            yesShares={yesShares}
            noShares={noShares}
            status={status}
            authed={authed}
            positions={positions}
          />
          <OrderBookLadder marketId={slug} outcome="YES" />
          <LimitOrderForm
            marketId={marketId}
            authed={authed}
            marketOpen={tradeOpen}
            yesPosition={positions.find((p) => p.outcome === "YES")}
            noPosition={positions.find((p) => p.outcome === "NO")}
          />
          {authed && <OpenOrdersPanel marketId={slug} />}
        </div>
      </BottomSheet>
    </>
  );
}
