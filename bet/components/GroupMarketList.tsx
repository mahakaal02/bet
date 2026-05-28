"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { GroupMarketRow, type GroupChildView } from "@/components/GroupMarketRow";
import { groupDisplayPrices } from "@/lib/market-group";
import { useTranslation } from "@/lib/i18n/client";

/**
 * The live, self-ranking candidate list for an event page.
 *
 * Owns the per-child price state: each row reports its latest YES (SSR seed or
 * live SSE tick) up via `onTick`; the list re-normalizes (display-only) and
 * re-sorts, animating row reorder with framer-motion `layout`.
 *
 * Connection budget: only the top `LIVE_CAP` children by initial price open an
 * SSE stream (browsers cap ~6 EventSources/host on HTTP/1.1). Any overflow
 * renders as static rows behind a "show all" toggle. The streamed set is fixed
 * at mount so connections never churn on reorder.
 */
const LIVE_CAP = 12;

export function GroupMarketList({
  items,
  exclusive,
}: {
  items: GroupChildView[];
  exclusive: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const [prices, setPrices] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((c) => [c.id, c.yesPrice])),
  );
  const onTick = useCallback((id: string, yesPrice: number) => {
    setPrices((prev) => (prev[id] === yesPrice ? prev : { ...prev, [id]: yesPrice }));
  }, []);

  // Stable streamed set: top LIVE_CAP by INITIAL price (not the live ranking),
  // so EventSources don't mount/unmount as rows reorder.
  const liveIds = useMemo(() => {
    const top = [...items].sort((a, b) => b.yesPrice - a.yesPrice).slice(0, LIVE_CAP);
    return new Set(top.map((c) => c.id));
  }, [items]);

  // Defer the (bursty) price updates so rapid ticks don't thrash the sort.
  const deferredPrices = useDeferredValue(prices);
  const ranked = useMemo(() => {
    const display = groupDisplayPrices(
      items.map((c) => ({ marketId: c.id, yesPrice: deferredPrices[c.id] ?? c.yesPrice })),
      exclusive,
    );
    const pctById = new Map(display.map((d) => [d.marketId, d.normalizedPct]));
    return [...items]
      .map((c) => ({
        child: c,
        live: deferredPrices[c.id] ?? c.yesPrice,
        pct: (pctById.get(c.id) ?? 0) / 100,
      }))
      .sort((a, b) => b.live - a.live);
  }, [items, deferredPrices, exclusive]);

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="py-10 text-center text-sm text-slate-400">{t("group.empty")}</div>
      </div>
    );
  }

  const visible = expanded ? ranked : ranked.slice(0, LIVE_CAP);
  const hasMore = ranked.length > LIVE_CAP;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2">
      <motion.ul layout>
        <AnimatePresence initial={false}>
          {visible.map((r, i) => (
            <motion.li
              key={r.child.id}
              layout
              transition={{ type: "spring", stiffness: 500, damping: 40 }}
            >
              <GroupMarketRow
                child={r.child}
                rank={i + 1}
                displayPct={r.pct}
                live={liveIds.has(r.child.id)}
                onTick={onTick}
              />
            </motion.li>
          ))}
        </AnimatePresence>
      </motion.ul>

      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 w-full rounded-lg py-2 text-center text-xs font-semibold text-cyan-300 hover:bg-slate-800/40"
        >
          {expanded ? t("group.showLess") : t("group.showAll", { count: ranked.length })}
        </button>
      )}
    </div>
  );
}
