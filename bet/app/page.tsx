import Link from "next/link";
import { Suspense } from "react";
import { TokenBridge } from "@/components/TokenBridge";
import { Navbar } from "@/components/Navbar";
import { ActivityTicker } from "@/components/ActivityTicker";
import { FeaturedCarousel } from "@/components/FeaturedCarousel";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { db } from "@/lib/db";
import { priceYes } from "@/lib/amm";
import { fmtCoins, fmtPrice } from "@/lib/utils";
import {
  TrendingUp,
  Trophy,
  Coins,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  // Pull the top markets + leaderboard for the landing widgets. These are
  // cheap reads — < 10ms on a warm Postgres — so we render server-side.
  const [featured, trending, leaderboard, stats] = await Promise.all([
    db.market.findMany({
      where: { status: "OPEN", featured: true },
      orderBy: { trendingScore: "desc" },
      take: 8,
    }),
    db.market.findMany({
      // Trending excludes featured markets so we don't double-render the
      // same card in both rails.
      where: { status: "OPEN", featured: false },
      orderBy: { trendingScore: "desc" },
      take: 6,
    }),
    db.user.findMany({
      orderBy: { xp: "desc" },
      take: 5,
      select: { id: true, username: true, image: true, xp: true, level: true },
    }),
    db.$transaction([
      db.market.count(),
      db.market.count({ where: { status: "OPEN" } }),
      db.trade.count(),
      db.user.count(),
    ]),
  ]);

  const [marketCount, openMarkets, tradeCount, userCount] = stats;

  return (
    <>
      <Suspense fallback={null}>
        <TokenBridge />
      </Suspense>
      <Navbar />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.12),transparent_40%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom,rgba(129,140,248,0.12),transparent_50%)]" />
        <div className="relative mx-auto max-w-7xl px-4 pt-12 pb-16 md:pt-20 md:pb-24">
          {/* The "One wallet · three games" badge + cross-product blurb +
              "Create account" CTA were dropped from this hero. Cross-app
              messaging belongs on the Kalki hub at :3200/, not the Bet
              landing, and account creation lives on the auctions login
              page now that user identity is unified. */}
          <h1 className="text-4xl font-black tracking-tight text-slate-50 md:text-6xl">
            Trade <span className="gradient-accent">prediction markets</span>
            <br />
            on the Kalki Bet wallet.
          </h1>
          <p className="mt-4 max-w-2xl text-base text-slate-400 md:text-lg">
            Politics, sports, crypto, tech. Take a YES or NO position on
            whether something happens — prices move with the crowd.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/markets">
              <Button size="lg">
                Explore markets <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
          <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatBox value={fmtCoins(marketCount)} label="Markets" />
            <StatBox value={fmtCoins(openMarkets)} label="Open" />
            <StatBox value={fmtCoins(tradeCount)} label="Trades" />
            <StatBox value={fmtCoins(userCount)} label="Traders" />
          </div>
        </div>
      </section>

      {/* Live activity ticker */}
      <section className="mx-auto max-w-7xl px-4 pb-8">
        <ActivityTicker />
      </section>

      {/* Featured */}
      <FeaturedCarousel
        markets={featured.map((m) => ({
          id: m.id,
          slug: m.slug,
          title: m.title,
          category: m.category,
          bannerUrl: m.bannerUrl,
          yesShares: m.yesShares,
          noShares: m.noShares,
          volumeCoins: m.volumeCoins,
          endsAt: m.endsAt,
        }))}
      />

      {/* Trending */}
      <section className="mx-auto max-w-7xl px-4 pb-12">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <TrendingUp className="h-5 w-5 text-cyan-400" /> Trending markets
          </h2>
          <Link
            href="/markets"
            className="text-sm text-cyan-300 hover:text-cyan-200"
          >
            See all →
          </Link>
        </div>
        {trending.length === 0 ? (
          <Card>
            <div className="py-8 text-center text-sm text-slate-400">
              No open markets yet. An admin needs to create one.
            </div>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {trending.map((m) => {
              const p = priceYes({
                yesShares: m.yesShares,
                noShares: m.noShares,
              });
              return (
                <Link key={m.id} href={`/markets/${m.slug}`}>
                  <Card className="fade-up h-full transition hover:border-cyan-500/30 hover:shadow-lg hover:shadow-cyan-500/5">
                    <div className="mb-2 flex items-center justify-between">
                      <Badge>{m.category}</Badge>
                      <span className="text-[10px] text-slate-500">
                        Vol {fmtCoins(m.volumeCoins)}
                      </span>
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
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-7xl px-4 pb-12">
        <h2 className="mb-4 text-xl font-bold">How it works</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <HowStep
            n={1}
            icon={<Coins className="h-5 w-5 text-cyan-400" />}
            title="Top up your wallet"
            body="Sign up gets you 10,000 starter coins. Buy more on the wallet page — the same balance works across Bet, auctions and Aviator."
          />
          <HowStep
            n={2}
            icon={<TrendingUp className="h-5 w-5 text-emerald-400" />}
            title="Pick a market"
            body="Politics, sports, crypto, tech, entertainment. Buy YES if you think it'll happen, NO if not."
          />
          <HowStep
            n={3}
            icon={<Trophy className="h-5 w-5 text-amber-400" />}
            title="Get paid out"
            body="When the market resolves, every share of the winning side pays 1 coin. Roll the winnings into the next round — or onto another game."
          />
        </div>
      </section>

      {/* Leaderboard preview */}
      <section className="mx-auto max-w-7xl px-4 pb-16">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <Trophy className="h-5 w-5 text-amber-400" /> Top traders
          </h2>
          <Link
            href="/leaderboard"
            className="text-sm text-cyan-300 hover:text-cyan-200"
          >
            Full leaderboard →
          </Link>
        </div>
        <Card>
          <ol className="divide-y divide-slate-800">
            {leaderboard.length === 0 ? (
              <li className="py-4 text-sm text-slate-400">
                No traders yet. Be the first.
              </li>
            ) : (
              leaderboard.map((u, i) => (
                <li
                  key={u.id}
                  className="flex items-center justify-between py-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="grid h-7 w-7 place-items-center rounded-full bg-slate-800 text-xs font-bold text-slate-300">
                      {i + 1}
                    </div>
                    <span className="font-semibold">{u.username}</span>
                    <Badge tone="info">Lvl {u.level}</Badge>
                  </div>
                  <span className="text-sm text-slate-400">
                    {fmtCoins(u.xp)} XP
                  </span>
                </li>
              ))
            )}
          </ol>
        </Card>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-950/60 py-8 text-center text-xs text-slate-500">
        <div className="mx-auto max-w-2xl px-4">
          <ShieldCheck className="mx-auto mb-2 h-4 w-4 text-emerald-400" />
          Kalki Exchange — prediction markets with verified outcomes.
        </div>
      </footer>
    </>
  );
}

function StatBox({ value, label }: { value: string; label: string }) {
  return (
    <div className="glass rounded-xl p-4">
      <div className="text-2xl font-black text-slate-100">{value}</div>
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}

function HowStep({
  n,
  icon,
  title,
  body,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card className="relative">
      <div className="absolute right-3 top-3 text-3xl font-black text-slate-800">
        0{n}
      </div>
      <div className="mb-2">{icon}</div>
      <h3 className="text-base font-bold text-slate-100">{title}</h3>
      <p className="mt-1 text-sm text-slate-400">{body}</p>
    </Card>
  );
}
