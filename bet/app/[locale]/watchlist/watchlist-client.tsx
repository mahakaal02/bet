"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/Toaster";
import { useTranslation } from "@/lib/i18n/client";

async function setWatching(marketId: string, watching: boolean): Promise<boolean> {
  try {
    const res = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marketId, watching }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Filled star → removes the market from the watchlist, then refreshes. */
export function WatchStar({ marketId }: { marketId: string }) {
  const router = useRouter();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function remove() {
    setBusy(true);
    const ok = await setWatching(marketId, false);
    if (ok) startTransition(() => router.refresh());
    else {
      setBusy(false);
      toast(t("watchlist.couldntUpdate"), "err");
    }
  }

  return (
    <button
      type="button"
      className="star"
      onClick={remove}
      disabled={busy}
      title={t("watchlist.removeFromWatchlist")}
      aria-label={t("watchlist.removeFromWatchlist")}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <polygon points="12 2 15 8.7 22 9.3 17 14 18.5 21 12 17.3 5.5 21 7 14 2 9.3 9 8.7 12 2" />
      </svg>
    </button>
  );
}

/** "+" → adds a suggested market to the watchlist, then refreshes. */
export function WatchAdd({ marketId }: { marketId: string }) {
  const router = useRouter();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function add() {
    setBusy(true);
    const ok = await setWatching(marketId, true);
    if (ok) startTransition(() => router.refresh());
    else {
      setBusy(false);
      toast(t("watchlist.couldntUpdate"), "err");
    }
  }

  return (
    <button
      type="button"
      className="add"
      onClick={add}
      disabled={busy}
      title={t("watchlist.addToWatchlist")}
      aria-label={t("watchlist.addToWatchlist")}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>
  );
}
