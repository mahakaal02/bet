import { cn } from "@/lib/utils";

/**
 * Pulsing placeholder block. The `.skeleton` utility class (defined in
 * globals.css) drives the animation; this component just wraps the prop
 * surface so callers don't repeat the same className everywhere.
 *
 * Use these in `loading.tsx` siblings (Next App Router streaming) — the
 * placeholder ships in the initial HTML, gets swapped to the real content
 * once the server render of `page.tsx` lands.
 */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <div className={cn("skeleton", className)} style={style} />;
}

/** Compact row used by lists (positions, leaderboard, etc.). */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border-b border-slate-800 py-3 last:border-b-0",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-2 w-20" />
        </div>
      </div>
      <Skeleton className="h-4 w-16" />
    </div>
  );
}

/** Card-shaped skeleton (header + body bars). */
export function SkeletonCard({
  rows = 4,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-800 bg-slate-900/60 p-4",
        className,
      )}
    >
      <Skeleton className="mb-4 h-3 w-24" />
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-full" />
        ))}
      </div>
    </div>
  );
}
