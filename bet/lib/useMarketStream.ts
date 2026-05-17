"use client";

import { useEffect, useState } from "react";

export interface MarketTick {
  yesPrice: number;
  noPrice: number;
  volumeCoins?: number;
  status?: string;
  // Set only on a trade tick — used to flash the side that just printed.
  lastSide?: "YES" | "NO" | null;
  lastCost?: number;
  resolved?: boolean;
  resolvedOutcome?: "YES" | "NO" | "CANCELLED" | null;
  at: number;
}

/**
 * Subscribe to /api/markets/{id}/stream via EventSource. `id` may be the
 * market id or its slug — the server accepts both.
 *
 * Returns the latest tick (or null until the snapshot lands). When the page
 * goes to a backgrounded tab the browser keeps the SSE alive; on hard
 * network drops EventSource auto-reconnects with exponential backoff.
 */
export function useMarketStream(idOrSlug: string, initialYes?: number): MarketTick | null {
  const [tick, setTick] = useState<MarketTick | null>(
    typeof initialYes === "number"
      ? {
          yesPrice: initialYes,
          noPrice: 1 - initialYes,
          at: Date.now(),
          lastSide: null,
        }
      : null,
  );

  useEffect(() => {
    if (!idOrSlug) return;
    const src = new EventSource(`/api/markets/${idOrSlug}/stream`);

    src.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "snapshot") {
          setTick({
            yesPrice: data.yesPrice,
            noPrice: data.noPrice,
            volumeCoins: data.volumeCoins,
            status: data.status,
            at: Date.now(),
            lastSide: null,
          });
        } else if (data.type === "trade") {
          setTick((prev) => ({
            yesPrice: data.yesPrice,
            noPrice: data.noPrice,
            volumeCoins: data.volumeCoins ?? prev?.volumeCoins,
            status: prev?.status,
            lastSide: data.side ?? null,
            lastCost: data.cost,
            at: data.at ?? Date.now(),
          }));
        } else if (data.type === "resolved") {
          setTick({
            yesPrice: data.yesPrice,
            noPrice: data.noPrice,
            resolved: true,
            resolvedOutcome: data.outcome,
            status: "RESOLVED",
            at: data.at ?? Date.now(),
            lastSide: null,
          });
        }
      } catch {
        /* malformed event — drop */
      }
    };

    src.onerror = () => {
      // EventSource auto-reconnects; we keep showing the last tick until then.
    };

    return () => {
      src.close();
    };
  }, [idOrSlug]);

  return tick;
}
