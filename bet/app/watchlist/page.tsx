import Link from "next/link";
import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { priceYes } from "@/lib/amm";
import { fmtCoins, fmtPrice, timeAgo } from "@/lib/utils";
import { Star } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const u = await getAuthedUser();
  if (!u) redirect("/login?next=/watchlist");

  const rows = await db.watchlist.findMany({
    where: { userId: u.id },
    orderBy: { createdAt: "desc" },
    include: { market: true },
  });

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-4 flex items-center gap-2">
          <Star className="h-6 w-6 text-amber-400" />
          <h1 className="text-2xl font-black">Watchlist</h1>
          <span className="text-sm text-slate-500">· {rows.length}</span>
        </div>

        {rows.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-sm text-slate-400">
              You haven&apos;t starred any markets yet. Tap the{" "}
              <Star className="inline h-3 w-3" /> on a market to add it.
            </p>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((row) => {
              const m = row.market;
              const p = priceYes({
                yesShares: m.yesShares,
                noShares: m.noShares,
              });
              const resolved =
                m.status === "RESOLVED" || m.status === "CANCELLED";
              return (
                <Link key={row.id} href={`/markets/${m.slug}`}>
                  <Card className="fade-up h-full transition hover:border-cyan-500/30">
                    <div className="mb-2 flex items-center justify-between">
                      <Badge>{m.category}</Badge>
                      {resolved ? (
                        <Badge
                          tone={
                            m.resolvedAs === "YES"
                              ? "yes"
                              : m.resolvedAs === "NO"
                                ? "no"
                                : "warn"
                          }
                        >
                          {m.status === "CANCELLED"
                            ? "Cancelled"
                            : `Resolved ${m.resolvedAs}`}
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-slate-500">
                          {m.status === "OPEN"
                            ? `Ends ${new Date(m.endsAt).toLocaleDateString()}`
                            : "Closed"}
                        </span>
                      )}
                    </div>
                    <h3 className="line-clamp-2 text-sm font-semibold text-slate-100">
                      {m.title}
                    </h3>
                    <div className="mt-3 flex items-center justify-between">
                      <div>
                        <div className="text-xs text-slate-500">YES</div>
                        <div className="text-lg font-bold text-emerald-300">
                          {fmtPrice(p)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-slate-500">NO</div>
                        <div className="text-lg font-bold text-rose-300">
                          {fmtPrice(1 - p)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 text-[10px] text-slate-500">
                      Watched {timeAgo(row.createdAt)} · Vol{" "}
                      {fmtCoins(m.volumeCoins)}
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
