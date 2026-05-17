"use client";

import { useState } from "react";
import { walletTopupUrl } from "@/lib/exchange-url";

/**
 * Coin-balance chip in the navbar. Tapping it opens the Exchange app's
 * wallet topup page with the user's bearer token attached for SSO —
 * matches the Android UX where the wallet button on every screen leads
 * to the same recharge surface.
 *
 * Why a Client Component: the wallet topup lives on a different origin
 * (`http://localhost:3100`) and we need to fetch the bearer token from
 * `/api/auth/token` before the redirect. That's all this does.
 */
export function TopupChip({ balance }: { balance: number }) {
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/token", { cache: "no-store" });
      const body = (await res.json()) as { token: string | null };
      window.location.href = walletTopupUrl(body.token);
    } catch {
      window.location.href = walletTopupUrl(null);
    }
  }

  const empty = balance <= 0;
  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      // The empty-wallet style is the high-contrast variant — when the
      // chip catches the user's eye it should be when they actually
      // need to top up.
      className={
        empty
          ? "inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/25 disabled:opacity-60"
          : "inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/15 disabled:opacity-60"
      }
      title={empty ? "Top up your wallet" : "Manage wallet"}
    >
      {balance.toLocaleString("en-IN")} coins
      <span className="ml-0.5 text-amber-300/80">›</span>
    </button>
  );
}
