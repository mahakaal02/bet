import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { fmtCoins, fmtPct } from "@/lib/utils";
import { type Locale } from "@/lib/i18n/config";

/** Pre-resolved (localized, formatted) data for one group card. The caller
 *  (markets list, a server component) does all i18n/formatting so this stays a
 *  dumb presentational card — visually identical to the inline market card. */
export interface GroupCardData {
  slug: string;
  title: string;
  /** Already-localized category label. */
  category: string;
  childCount: number;
  /** Aggregate volume across child markets. */
  volumeCoins: number;
  /** Leading candidate + its display share (0..1), or null when empty. */
  leader: { title: string; pct: number } | null;
  resolved: boolean;
  /** Localized "Resolved"/"Cancelled" label, shown when resolved. */
  resolvedLabel?: string;
}

/**
 * Group ("event") card for the markets list. Built from the same `Card` +
 * `Badge` primitives and the exact classes as the inline market card, so a
 * group and a standalone market sit side-by-side indistinguishably. The only
 * group-specific bit is the leader line + candidate-count badge.
 */
export function GroupCard({
  href,
  data,
  labels,
  locale,
}: {
  href: string;
  data: GroupCardData;
  labels: { candidates: string; chance: string; vol: string };
  locale: Locale;
}) {
  return (
    <Link href={href}>
      <Card className="fade-up h-full transition hover:border-cyan-500/30">
        <div className="mb-2 flex items-center justify-between">
          <Badge>{data.category}</Badge>
          {data.resolved ? (
            <Badge tone="info">{data.resolvedLabel}</Badge>
          ) : (
            <span className="text-[10px] text-slate-500">
              {data.childCount} {labels.candidates}
            </span>
          )}
        </div>
        <h3 className="line-clamp-2 text-sm font-semibold text-slate-100">{data.title}</h3>
        {data.leader && (
          <div className="mt-3 flex items-end justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs text-slate-500">{labels.chance}</div>
              <div className="line-clamp-1 text-xs text-slate-300">{data.leader.title}</div>
            </div>
            <div className="shrink-0 text-lg font-bold text-emerald-300">
              {fmtPct(data.leader.pct)}
            </div>
          </div>
        )}
        <div className="mt-3 text-[10px] text-slate-500">
          {labels.vol} {fmtCoins(data.volumeCoins, locale)}
        </div>
      </Card>
    </Link>
  );
}
