import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { db } from "@/lib/db";
import { priceYes } from "@/lib/amm";
import { fmtCoins, fmtPrice } from "@/lib/utils";
import Link from "next/link";
import { Search } from "lucide-react";
import type { MarketCategory } from "@prisma/client";

export const dynamic = "force-dynamic";

const CATEGORIES: { value: MarketCategory | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "POLITICS", label: "Politics" },
  { value: "SPORTS", label: "Sports" },
  { value: "CRYPTO", label: "Crypto" },
  { value: "TECH", label: "Tech" },
  { value: "ENTERTAINMENT", label: "Ent." },
];

export default async function MarketsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cat?: string; sort?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const cat = (sp.cat ?? "ALL").toUpperCase();
  const sort = sp.sort ?? "trending";
  const status = (sp.status ?? "OPEN").toUpperCase();

  const validCat = CATEGORIES.find((c) => c.value === cat)?.value ?? "ALL";

  const markets = await db.market.findMany({
    where: {
      ...(status !== "ALL" && { status: status as "OPEN" | "RESOLVED" | "CLOSED" | "CANCELLED" }),
      ...(validCat !== "ALL" && { category: validCat as MarketCategory }),
      ...(q && {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
        ],
      }),
    },
    orderBy:
      sort === "volume"
        ? { volumeCoins: "desc" }
        : sort === "ending"
          ? { endsAt: "asc" }
          : sort === "new"
            ? { createdAt: "desc" }
            : { trendingScore: "desc" },
    take: 60,
  });

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-4">
          <h1 className="text-2xl font-black">Markets</h1>
          <p className="text-sm text-slate-400">
            {markets.length} {status === "OPEN" ? "open" : status.toLowerCase()} market
            {markets.length === 1 ? "" : "s"}
          </p>
        </div>

        <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              name="q"
              defaultValue={q}
              placeholder="Search markets…"
              className="pl-9"
            />
          </div>
          <select
            name="sort"
            defaultValue={sort}
            className="h-10 rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-sm"
          >
            <option value="trending">Trending</option>
            <option value="volume">Volume</option>
            <option value="ending">Ending soon</option>
            <option value="new">Newest</option>
          </select>
          <select
            name="status"
            defaultValue={status}
            className="h-10 rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-sm"
          >
            <option value="OPEN">Open</option>
            <option value="RESOLVED">Resolved</option>
            <option value="ALL">All</option>
          </select>
          {validCat !== "ALL" && <input type="hidden" name="cat" value={validCat} />}
          <button
            type="submit"
            className="h-10 rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-sm font-semibold text-slate-200 hover:bg-slate-800"
          >
            Apply
          </button>
        </form>

        <div className="mb-4 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => {
            const active = c.value === validCat;
            const href =
              c.value === "ALL"
                ? `/markets?q=${encodeURIComponent(q)}&sort=${sort}&status=${status}`
                : `/markets?q=${encodeURIComponent(q)}&cat=${c.value}&sort=${sort}&status=${status}`;
            return (
              <Link
                key={c.value}
                href={href}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  active
                    ? "border-cyan-500/50 bg-cyan-500/20 text-cyan-200"
                    : "border-slate-700 bg-slate-900/60 text-slate-400 hover:text-slate-200"
                }`}
              >
                {c.label}
              </Link>
            );
          })}
        </div>

        {markets.length === 0 ? (
          <Card>
            <div className="py-10 text-center text-sm text-slate-400">
              No markets match these filters.
            </div>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {markets.map((m) => {
              const p = priceYes({ yesShares: m.yesShares, noShares: m.noShares });
              const resolved = m.status === "RESOLVED" || m.status === "CANCELLED";
              return (
                <Link key={m.id} href={`/markets/${m.slug}`}>
                  <Card className="fade-up h-full transition hover:border-cyan-500/30">
                    <div className="mb-2 flex items-center justify-between">
                      <Badge>{m.category}</Badge>
                      {resolved ? (
                        <Badge tone={m.resolvedAs === "YES" ? "yes" : m.resolvedAs === "NO" ? "no" : "warn"}>
                          {m.status === "CANCELLED" ? "Cancelled" : `Resolved ${m.resolvedAs}`}
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-slate-500">
                          Ends {new Date(m.endsAt).toLocaleDateString()}
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
                      Vol {fmtCoins(m.volumeCoins)} · {fmtCoins(Math.round(m.yesShares + m.noShares))} liq.
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
