import { Navbar } from "@/components/Navbar";
import { Skeleton, SkeletonRow, SkeletonCard } from "@/components/Skeleton";

/**
 * Skeleton for /profile. Three column header (avatar/info + level/streak +
 * wallet), then referral, achievements grid, watchlist, activity feed.
 */
export default function Loading() {
  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 md:col-span-2">
            <div className="flex items-center gap-4">
              <Skeleton className="h-14 w-14 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-3 w-48" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="mt-4 h-2 w-full rounded-full" />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <Skeleton className="mb-2 h-3 w-16" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="mt-3 h-8 w-full" />
          </div>
        </div>

        <SkeletonCard className="mt-4" rows={2} />

        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <Skeleton className="mb-3 h-3 w-32" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <Skeleton className="mb-3 h-3 w-24" />
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </div>
    </main>
  );
}
