"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toaster";

export function ResolveMarketPanel({ marketId }: { marketId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function resolve(as: "YES" | "NO" | "CANCELLED") {
    const verb = as === "CANCELLED" ? "cancel" : `resolve as ${as}`;
    if (!confirm(`Really ${verb}? Payouts run immediately.`)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/markets/${marketId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: as, note }),
    });
    setBusy(false);
    if (res.ok) {
      const body = await res.json();
      const orderTail =
        body.ordersCancelled > 0
          ? ` Released ${body.ordersCancelled} open order${body.ordersCancelled === 1 ? "" : "s"} (refunded ${body.ordersRefundedCoins} coins).`
          : "";
      toast(
        as === "CANCELLED"
          ? `Cancelled. Refunds issued.${orderTail}`
          : `Resolved ${as}. Paid out ${body.paidOut} coins to ${body.payoutCount} positions.${orderTail}`,
        "ok",
      );
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      toast(body.error ?? "Resolve failed.", "err");
    }
  }

  return (
    <div className="space-y-3">
      <Input
        placeholder="Optional resolution note (shown to traders)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="yes" disabled={busy} onClick={() => resolve("YES")}>
          Resolve YES
        </Button>
        <Button variant="no" disabled={busy} onClick={() => resolve("NO")}>
          Resolve NO
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => resolve("CANCELLED")}
        >
          Cancel & refund
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        Cancelling refunds every position holder their costBasis. Resolving
        YES/NO pays 1 coin per winning share to the holders.
      </p>
    </div>
  );
}
