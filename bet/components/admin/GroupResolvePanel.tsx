"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toaster";

interface GroupResolvePanelProps {
  groupId: string;
  /** Member markets, in display order. */
  markets: { id: string; title: string; status: string }[];
}

/**
 * Group settlement trigger for EXCLUSIVE events. Pick the winning child
 * (resolves YES; every other child resolves NO) or cancel the whole event
 * (every child refunded). Mirrors `ResolveMarketPanel` — payouts run per
 * child server-side via the shared settlement engine, and the endpoint is
 * safely retryable, so a partial failure just needs a re-submit.
 */
export function GroupResolvePanel({ groupId, markets }: GroupResolvePanelProps) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [winner, setWinner] = useState(markets[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  async function submit(payload: Record<string, unknown>, verb: string) {
    if (!confirm(`Really ${verb}? Payouts run immediately for every market.`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/market-groups/${groupId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, note }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        const skipTail =
          body.skipped > 0 ? ` (${body.skipped} already settled)` : "";
        toast(`Settled ${body.resolved} market(s)${skipTail}.`, "ok");
        router.refresh();
      } else if (body.error === "partial_failure") {
        toast(
          `Settled ${body.resolved}, ${body.failed?.length ?? 0} failed. Fix and re-submit to finish.`,
          "err",
        );
        router.refresh();
      } else {
        toast(body.error ?? "Resolve failed.", "err");
      }
    } finally {
      setBusy(false);
    }
  }

  if (markets.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        Attach markets to this event before resolving it.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
          Winning market
        </span>
        <select
          value={winner}
          disabled={busy}
          onChange={(e) => setWinner(e.target.value)}
          className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-sm disabled:opacity-60"
        >
          {markets.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
              {m.status !== "OPEN" && m.status !== "CLOSED"
                ? ` (${m.status})`
                : ""}
            </option>
          ))}
        </select>
      </label>
      <Input
        placeholder="Optional resolution note (shown to traders)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="yes"
          disabled={busy || !winner}
          onClick={() => submit({ winnerMarketId: winner }, "resolve this event")}
        >
          Resolve event
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => submit({ outcome: "CANCELLED" }, "cancel this event")}
        >
          Cancel & refund all
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        Resolving pays the winning market’s YES holders 1 coin per share; every
        other market resolves NO. Cancelling refunds every position holder
        their costBasis. Each market settles independently and the action is
        safe to re-run.
      </p>
    </div>
  );
}
