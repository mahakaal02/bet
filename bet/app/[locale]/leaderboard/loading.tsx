import { Navbar } from "@/components/Navbar";
import { Trophy } from "lucide-react";
import { Skeleton, SkeletonRow } from "@/components/Skeleton";

/** Skeleton for /leaderboard — title + 10 rank rows. */
export default function Loading() {
  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-4 flex items-center gap-2">
          <Trophy className="h-6 w-6 text-amber-400" />
          <Skeleton className="h-6 w-40" />
        </div>
        <Skeleton className="h-3 w-72" />

        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </div>
    </main>
  );
}
