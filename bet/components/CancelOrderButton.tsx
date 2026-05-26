"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Admin force-cancel a single open order. Hits the admin DELETE
 * endpoint which refunds the unfilled reservation and logs the action.
 * Uses `router.refresh()` to re-render the server component above so
 * the cancelled row drops out of the book.
 */
export function CancelOrderButton({
  orderId,
  disabled,
  tinyVariant,
}: {
  orderId: string;
  disabled?: boolean;
  tinyVariant?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (disabled || busy) return;
    if (
      !window.confirm(
        "Force-cancel this order? The unfilled portion refunds to the user's wallet (BUY) or releases their share lock (SELL). This is logged.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "cancel failed");
    } finally {
      setBusy(false);
    }
  }

  if (tinyVariant) {
    return (
      <div className="text-end">
        <button
          type="button"
          onClick={onClick}
          disabled={disabled || busy}
          className="text-[10px] font-semibold uppercase tracking-wider text-rose-300 hover:text-rose-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? "…" : "cancel"}
        </button>
        {error && <div className="text-[10px] text-rose-400">{error}</div>}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {busy ? "Cancelling…" : "Force cancel"}
    </button>
  );
}
