"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { toast } from "@/components/ui/Toaster";
import { cn, fmtCoins, fmtPrice } from "@/lib/utils";

interface Props {
  marketId: string;
  authed: boolean;
  marketOpen: boolean;
  yesPosition?: { shares: number; locked: number };
  noPosition?: { shares: number; locked: number };
}

/**
 * Limit-order entry panel. Sits next to the AMM trade panel; users opt into
 * limit orders if they want price control. We don't try to be too clever
 * with quote previews here — the orderbook ladder above shows depth, and
 * the matcher resolves price improvement on the server.
 */
export function LimitOrderForm({
  marketId,
  authed,
  marketOpen,
  yesPosition,
  noPosition,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<"YES" | "NO">("YES");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [priceInput, setPriceInput] = useState("0.55");
  const [sharesInput, setSharesInput] = useState("100");
  const [busy, setBusy] = useState(false);

  const price = Number(priceInput);
  const shares = Number(sharesInput);
  const valid =
    Number.isFinite(price) &&
    price > 0 &&
    price < 1 &&
    Number.isFinite(shares) &&
    shares > 0;

  const lockEstimate = side === "BUY" ? Math.ceil(price * shares) : shares;
  const lockLabel = side === "BUY" ? "coins" : "shares";

  const pos = outcome === "YES" ? yesPosition : noPosition;
  const available = pos ? Math.max(0, pos.shares - pos.locked) : 0;

  async function submit() {
    if (!valid) return;
    setBusy(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketId,
          outcome,
          side,
          limitPrice: price,
          shares,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(prettyOrderError(body.error), "err");
        return;
      }
      const filled = body.order.filledShares as number;
      if (filled > 0 && body.order.remaining > 0) {
        toast(`Filled ${filled.toFixed(2)}, ${body.order.remaining.toFixed(2)} resting.`, "ok");
      } else if (filled > 0) {
        toast(`Filled ${filled.toFixed(2)} shares.`, "ok");
      } else {
        toast(`Order resting at ${fmtPrice(price)}.`, "info");
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Limit order
        </span>
        <Badge tone="info">Advanced</Badge>
      </div>

      <div className="mb-2 flex gap-2">
        {(["YES", "NO"] as const).map((o) => (
          <button
            key={o}
            onClick={() => setOutcome(o)}
            className={cn(
              "flex-1 rounded-md border py-1.5 text-xs font-bold",
              outcome === o
                ? o === "YES"
                  ? "border-emerald-500 bg-emerald-500/15 text-emerald-200"
                  : "border-rose-500 bg-rose-500/15 text-rose-200"
                : "border-slate-700 bg-slate-900/60 text-slate-400 hover:text-slate-200",
            )}
          >
            {o}
          </button>
        ))}
      </div>

      <div className="mb-2 flex gap-2">
        {(["BUY", "SELL"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className={cn(
              "flex-1 rounded-md border py-1.5 text-xs font-bold",
              side === s
                ? "border-cyan-500 bg-cyan-500/15 text-cyan-200"
                : "border-slate-700 bg-slate-900/60 text-slate-400 hover:text-slate-200",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Price (0.01 – 0.99)
          </label>
          <Input
            type="number"
            step="0.01"
            min="0.01"
            max="0.99"
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            disabled={!authed || !marketOpen}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Shares
          </label>
          <Input
            type="number"
            min="1"
            value={sharesInput}
            onChange={(e) => setSharesInput(e.target.value)}
            disabled={!authed || !marketOpen}
          />
        </div>
      </div>

      {side === "SELL" && (
        <div className="mt-2 text-[11px] text-slate-500">
          Available to sell:{" "}
          <span className="font-mono text-slate-300">
            {available.toFixed(2)} {outcome}
          </span>
          {pos && pos.locked > 0 && (
            <span className="ml-1 text-slate-600">
              · {pos.locked.toFixed(2)} locked in orders
            </span>
          )}
        </div>
      )}

      <Button
        className="mt-3 w-full"
        variant={side === "BUY" ? "yes" : "no"}
        disabled={!authed || !marketOpen || !valid || busy}
        onClick={submit}
      >
        {busy
          ? "Placing…"
          : `${side} ${outcome} · lock ${fmtCoins(lockEstimate)} ${lockLabel}`}
      </Button>

      <p className="mt-2 text-[10px] leading-snug text-slate-500">
        Crosses the book if a maker beats your limit (you get the better
        price). Otherwise rests as a maker.
      </p>
    </Card>
  );
}

function prettyOrderError(code?: string): string {
  switch (code) {
    case "insufficient_coins":
      return "Not enough coins to cover the worst-case fill.";
    case "insufficient_shares":
      return "You don't have enough shares to sell that many.";
    case "market_not_open":
    case "market_ended":
      return "This market is not accepting orders.";
    case "rate_limited":
      return "Too many orders too fast — slow down.";
    case "invalid_input":
      return "Check the price (0.01–0.99) and shares.";
    case "unauthorized":
      return "Sign in to place orders.";
    default:
      return "Order failed.";
  }
}
