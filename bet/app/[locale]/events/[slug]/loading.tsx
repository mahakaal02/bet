import { Navbar } from "@/components/Navbar";
import { Skeleton, SkeletonRow } from "@/components/Skeleton";

export default function Loading() {
  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-3xl px-4 py-6">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="mt-3 h-7 w-64" />
        <Skeleton className="mt-2 h-3 w-32" />
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </div>
    </main>
  );
}
