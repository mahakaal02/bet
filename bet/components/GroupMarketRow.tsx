"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ProbabilityBar } from "@/components/ProbabilityBar";
import { useMarketStream } from "@/lib/useMarketStream";
import { cn, fmtCoins, fmtPct, fmtPrice } from "@/lib/utils";
import { localizedPath, useTranslation } from "@/lib/i18n/client";

/** SSR snapshot of one child market, shaped for the group row. `yesPrice` is
 *  already resolution-adjusted (1/0 for resolved YES/NO) by the page. */
export interface GroupChildView {
  id: string;
  slug: string;
  title: string;
  status: "OPEN" | "CLOSED" | "RESOLVED" | "CANCELLED";
  resolvedAs: "YES" | "NO" | null;
  yesPrice: number;
  volumeCoins: number;
}

interface GroupMarketRowProps {
  child: GroupChildView;
  rank: number;
  /** 0..1 display share computed by the list (normalized or raw). */
  displayPct: number;
  /** Whether this row subscribes to the live SSE stream. */
  live: boolean;
  onTick: (id: string, yesPrice: number) => void;
}

/**
 * One candidate row in a grouped event — a lightweight, tradable instrument:
 * rank · title (→ child market) · probability bar · YES/NO/vol · live % + Buy.
 * Streams via the existing per-market SSE so the row (and the list's ranking)
 * updates in real time. Renders a <div> so the parent can wrap it in a
 * <motion.li> for reorder animation.
 */
export function GroupMarketRow({ child, rank, displayPct, live, onTick }: GroupMarketRowProps) {
  const { t, locale } = useTranslation();
  // Passing "" as the id makes the hook skip the EventSource (see
  // useMarketStream) — non-live tail rows stay on their SSR price.
  const tick = useMarketStream(live ? child.id : "", child.yesPrice);
  const yes = tick?.yesPrice ?? child.yesPrice;

  useEffect(() => {
    onTick(child.id, yes);
  }, [child.id, yes, onTick]);

  const resolved = child.status === "RESOLVED" || child.status === "CANCELLED";
  const flash =
    tick?.lastSide === "YES" ? "ticker-up" : tick?.lastSide === "NO" ? "ticker-down" : "";
  const href = localizedPath(`/markets/${child.slug}`, locale);

  return (
    <div
      className={cn(
        "-mx-2 flex items-center gap-3 rounded-lg border-b border-slate-800 px-2 py-3 transition last:border-b-0 hover:bg-slate-800/30",
        resolved && "opacity-60",
      )}
    >
      <span className="w-6 shrink-0 text-center font-mono text-xs text-slate-500">{rank}</span>

      <div className="min-w-0 flex-1">
        <Link href={href} className="block">
          <div className="line-clamp-1 text-sm font-semibold text-slate-100 hover:text-cyan-200">
            {child.title}
          </div>
        </Link>
        <ProbabilityBar pct={displayPct} className="mt-1.5" />
        <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-slate-500">
          <span>{t("market.yes")} {fmtPrice(yes)}</span>
          <span>·</span>
          <span>{t("market.no")} {fmtPrice(1 - yes)}</span>
          <span>·</span>
          <span>{t("group.vol")} {fmtCoins(child.volumeCoins)}</span>
        </div>
      </div>

      <div className="shrink-0 text-end">
        {resolved ? (
          <Badge tone={child.resolvedAs === "YES" ? "yes" : child.resolvedAs === "NO" ? "no" : "warn"}>
            {child.resolvedAs ?? t("market.resolved")}
          </Badge>
        ) : (
          <>
            <div className={cn("text-lg font-bold text-emerald-300", flash)}>
              {fmtPct(displayPct)}
            </div>
            <Link href={href}>
              <Button variant="yes" size="sm" className="mt-1">
                {t("group.buy")}
              </Button>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
