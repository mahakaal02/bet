import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { priceYes } from "@/lib/amm";
import { fmtCoins, fmtPrice, timeAgo } from "@/lib/utils";
import {
  DEFAULT_LOCALE,
  buildAuthRedirect,
  buildLocalizedMetadata,
  isLocale,
  localizedPath,
  t,
  type Locale,
} from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  return buildLocalizedMetadata({
    locale,
    path: "/portfolio",
    title: t("meta.portfolioTitle", locale),
    description: t("meta.portfolioDescription", locale),
    noindex: true,
  });
}

export default async function PortfolioPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);
  const lp = (h: string) => localizedPath(h, locale);

  const u = await getAuthedUser();
  if (!u) {
    const sp = await searchParams;
    redirect(buildAuthRedirect("/portfolio", sp, locale));
  }

  const [positions, recentTrades, wallet] = await Promise.all([
    db.position.findMany({
      where: { userId: u.id, shares: { gt: 0 } },
      include: { market: true },
      orderBy: { updatedAt: "desc" },
    }),
    db.trade.findMany({
      where: { userId: u.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { market: { select: { title: true, slug: true } } },
    }),
    db.wallet.findUnique({ where: { userId: u.id } }),
  ]);

  // Mark-to-market each position: shares × current price gives present value.
  // For resolved markets we use the resolved-as price (1 or 0).
  let totalCost = 0;
  let totalValue = 0;
  let realizedPnl = 0;
  const enriched = positions.map((p) => {
    const live =
      p.market.status === "RESOLVED" || p.market.status === "CANCELLED"
        ? p.market.resolvedAs === p.outcome
          ? 1
          : 0
        : p.outcome === "YES"
          ? priceYes({ yesShares: p.market.yesShares, noShares: p.market.noShares })
          : 1 - priceYes({ yesShares: p.market.yesShares, noShares: p.market.noShares });
    const value = Math.round(p.shares * live);
    const pnl = value - p.costBasis;
    totalCost += p.costBasis;
    totalValue += value;
    realizedPnl += p.realizedPnl;
    return { ...p, livePrice: live, value, pnl };
  });

  const unrealized = totalValue - totalCost;

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-6xl px-4 py-6">
        <h1 className="mb-1 text-2xl font-black">{tr("portfolio.heading")}</h1>
        <p className="text-sm text-slate-400">{tr("portfolio.subtext")}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <Stat label={tr("portfolio.wallet")} value={`${fmtCoins(wallet?.balance ?? 0)} 🪙`} />
          <Stat label={tr("portfolio.atCost")} value={`${fmtCoins(totalCost)}`} />
          <Stat label={tr("portfolio.valueNow")} value={`${fmtCoins(totalValue)}`} />
          <Stat
            label={tr("portfolio.pl")}
            value={`${unrealized >= 0 ? "+" : ""}${fmtCoins(unrealized)}`}
            tone={unrealized >= 0 ? "yes" : "no"}
          />
        </div>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>{tr("portfolio.openPositions")}</CardTitle>
            <span className="text-xs text-slate-500">{enriched.length}</span>
          </CardHeader>
          {enriched.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              <Link href={lp("/markets")} className="text-cyan-300 hover:text-cyan-200">
                {tr("portfolio.noPositions")}
              </Link>
            </p>
          ) : (
            <div className="divide-y divide-slate-800">
              {enriched.map((p) => (
                <Link
                  key={p.id}
                  href={lp(`/markets/${p.market.slug}`)}
                  className="grid grid-cols-[1fr_auto] gap-2 py-3 hover:bg-slate-900/40"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge tone={p.outcome === "YES" ? "yes" : "no"}>
                        {p.outcome}
                      </Badge>
                      <span className="line-clamp-1 text-sm font-semibold">
                        {p.market.title}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {p.shares.toFixed(1)} sh @ {fmtPrice(p.costBasis / Math.max(1, p.shares))} avg ·
                      now {fmtPrice(p.livePrice)}
                    </div>
                  </div>
                  <div className="text-end text-sm">
                    <div className="font-mono">{fmtCoins(p.value)}</div>
                    <div
                      className={`font-mono text-xs ${
                        p.pnl >= 0 ? "ticker-up" : "ticker-down"
                      }`}
                    >
                      {p.pnl >= 0 ? "+" : ""}
                      {fmtCoins(p.pnl)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>{tr("portfolio.recentTrades")}</CardTitle>
          </CardHeader>
          {recentTrades.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              {tr("portfolio.noTrades")}
            </p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {recentTrades.map((tx) => (
                <li
                  key={tx.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Badge tone={tx.outcome === "YES" ? "yes" : "no"}>
                      {tx.outcome}
                    </Badge>
                    <Link
                      href={lp(`/markets/${tx.market.slug}`)}
                      className="line-clamp-1 text-slate-300 hover:text-slate-100"
                    >
                      {tx.market.title}
                    </Link>
                  </div>
                  <div className="text-end">
                    <div className="font-mono">
                      −{fmtCoins(tx.cost)}{" "}
                      <span className="text-slate-500">@ {fmtPrice(tx.pricePerShare)}</span>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {timeAgo(tx.createdAt)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "yes" | "no";
}) {
  const cls =
    tone === "yes"
      ? "ticker-up"
      : tone === "no"
        ? "ticker-down"
        : "text-slate-100";
  return (
    <div className="glass rounded-xl p-4">
      <div className={`text-xl font-black ${cls}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </div>
    </div>
  );
}
