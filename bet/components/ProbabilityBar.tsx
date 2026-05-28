import { cn, fmtPct } from "@/lib/utils";

/**
 * Thin probability bar — emerald fill on a slate track, matching the YES color
 * language used across the market cards. Width animates via a CSS transition so
 * live ticks glide. Pure/presentational (no hooks) — safe in server or client
 * trees. `pct` is a 0..1 ratio (normalized share for EXCLUSIVE groups, raw YES%
 * otherwise — the parent decides which).
 */
export function ProbabilityBar({ pct, className }: { pct: number; className?: string }) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(pct) ? pct : 0));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-slate-800", className)}>
      <div
        className="h-full rounded-full bg-emerald-400 transition-[width] duration-500 ease-out"
        style={{ width: fmtPct(clamped) }}
      />
    </div>
  );
}
