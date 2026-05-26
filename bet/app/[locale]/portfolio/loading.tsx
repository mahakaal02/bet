import { Navbar } from "@/components/Navbar";
import { Skeleton, SkeletonRow, SkeletonCard } from "@/components/Skeleton";

/**
 * Streamed skeleton for /portfolio. Mirrors the real page's shape so the
 * layout doesn't shift when the server render lands: header + four stat
 * cards, then the open positions table, then a recent trades card.
 */
export default function Loading() {
  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-6xl px-4 py-6">
        <Skeleton className="mb-2 h-7 w-32" />
        <Skeleton className="h-3 w-72" />

        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass rounded-xl p-4">
              <Skeleton className="mb-2 h-6 w-24" />
              <Skeleton className="h-2 w-16" />
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <Skeleton className="mb-3 h-3 w-32" />
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>

        <SkeletonCard className="mt-4" rows={6} />
      </div>
    </main>
  );
}
