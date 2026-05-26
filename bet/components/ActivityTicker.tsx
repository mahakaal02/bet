"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Activity } from "lucide-react";
import { cn, fmtCoins, fmtPrice, timeAgo } from "@/lib/utils";
import {
  localizedPath,
  useTranslation,
} from "@/lib/i18n/client";

interface ActivityEvent {
  id: number;
  marketTitle: string;
  marketSlug: string;
  action: "BUY" | "SELL";
  outcome: "YES" | "NO";
  username: string;
  coins: number;
  shares: number;
  price: number;
  at: number;
}

const MAX_EVENTS = 12;

/**
 * Discord-style live ticker of every trade across every market. Subscribes
 * to the global SSE channel; new events animate in at the top and old ones
 * drop off after MAX_EVENTS. Public — no auth required.
 */
export function ActivityTicker() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const counterRef = useRef(0);

  const { t, locale } = useTranslation();

  useEffect(() => {
    const src = new EventSource("/api/activity/stream");
    src.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type !== "activity") return;
        counterRef.current += 1;
        setEvents((prev) =>
          [
            {
              id: counterRef.current,
              marketTitle: data.marketTitle,
              marketSlug: data.marketSlug,
              action: data.action,
              outcome: data.outcome,
              username: data.username,
              coins: data.coins,
              shares: data.shares,
              price: data.price,
              at: data.at ?? Date.now(),
            },
            ...prev,
          ].slice(0, MAX_EVENTS),
        );
      } catch {
        /* malformed event */
      }
    };
    return () => src.close();
  }, []);

  if (events.length === 0) {
    return (
      <div className="glass rounded-xl px-4 py-3 text-xs text-slate-500">
        <Activity className="me-1 inline h-3 w-3" />
        {t("activity.waitingForTrades")}
      </div>
    );
  }

  return (
    <div className="glass rounded-xl px-2 py-1">
      <div className="border-b border-white/5 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
        <Activity className="me-1 inline h-3 w-3 text-emerald-400" />
        {t("activity.liveActivity")}
      </div>
      <ul className="max-h-72 overflow-y-auto">
        {events.map((e) => (
          <li
            key={e.id}
            className={cn(
              "fade-up grid grid-cols-[auto_1fr_auto] items-center gap-2 px-2 py-1.5 text-xs",
              "border-b border-white/5 last:border-0",
            )}
          >
            <span
              className={cn(
                "rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase",
                e.action === "BUY"
                  ? e.outcome === "YES"
                    ? "bg-emerald-500/15 text-emerald-200"
                    : "bg-rose-500/15 text-rose-200"
                  : "bg-slate-700/40 text-slate-300",
              )}
            >
              {e.action} {e.outcome}
            </span>
            <Link
              href={localizedPath(`/markets/${e.marketSlug}`, locale)}
              className="line-clamp-1 text-slate-300 hover:text-slate-100"
            >
              <span className="font-mono text-[10px] text-slate-500">
                {e.username}
              </span>{" "}
              · {e.marketTitle}
            </Link>
            <div className="text-end">
              <div className="font-mono text-[11px]">
                {fmtCoins(e.coins)} <span className="text-slate-500">@</span>{" "}
                {fmtPrice(e.price)}
              </div>
              <div className="font-mono text-[9px] text-slate-500">
                {timeAgo(new Date(e.at))}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
