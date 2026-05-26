import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { db } from "@/lib/db";
import { priceYes } from "@/lib/amm";
import { fmtCoins, fmtPrice, timeAgo } from "@/lib/utils";
import { MarketTradePanel } from "@/components/MarketTradePanel";
import { PriceChart } from "@/components/PriceChart";
import { WatchToggle } from "@/components/WatchToggle";
import { ShareButton } from "@/components/ShareButton";
import { Comments } from "@/components/Comments";
import { OrderBookLadder } from "@/components/OrderBookLadder";
import { LimitOrderForm } from "@/components/LimitOrderForm";
import { OpenOrdersPanel } from "@/components/OpenOrdersPanel";
import { MobileTradeBar } from "@/components/MobileTradeBar";
import { getAuthedUser } from "@/lib/auth";
import {
  alternatesFor,
  isLocale,
  t,
  type Locale,
} from "@/lib/i18n";

export const dynamic = "force-dynamic";

/**
 * Per-market metadata. Title flows into the browser tab + share preview;
 * the OG image is supplied by the sibling `opengraph-image.tsx` file
 * convention so we don't need to set `openGraph.images` explicitly.
 *
 * Market titles are user-generated and stay in their authoring language —
 * no translation pass. Surrounding chrome (tab fallback, price tag) is
 * localized.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale: Locale = isLocale(raw) ? raw : "en";
  const origin = (
    process.env.NEXTAUTH_URL ?? "http://localhost:3100"
  ).replace(/\/$/, "");
  const m = await db.market.findUnique({
    where: { slug },
    select: {
      title: true,
      description: true,
      yesShares: true,
      noShares: true,
      status: true,
      resolvedAs: true,
    },
  });
  if (!m) {
    return {
      title: t("market.notFound", locale),
      alternates: {
        canonical: `${origin}/${locale}/markets/${slug}`,
        languages: alternatesFor(origin, `/markets/${slug}`),
      },
    };
  }

  const yes =
    m.status === "RESOLVED"
      ? m.resolvedAs === "YES"
        ? 1
        : 0
      : priceYes({ yesShares: m.yesShares, noShares: m.noShares });
  const priceTag = `${t("market.yes", locale)} ${yes.toFixed(2)} · ${t(
    "market.no",
    locale,
  )} ${(1 - yes).toFixed(2)}`;
  // First line of the description, capped for nice-looking previews.
  const teaser = m.description.split("\n")[0].slice(0, 180);

  return {
    title: m.title,
    description: `${priceTag} — ${teaser}`,
    alternates: {
      canonical: `${origin}/${locale}/markets/${slug}`,
      languages: alternatesFor(origin, `/markets/${slug}`),
    },
    openGraph: {
      title: m.title,
      description: priceTag,
    },
    twitter: {
      card: "summary_large_image",
      title: m.title,
      description: priceTag,
    },
  };
}

export default async function MarketPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: raw, slug } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);

  const market = await db.market.findUnique({
    where: { slug },
    include: {
      pricePoints: { orderBy: { recordedAt: "asc" }, take: 200 },
      _count: { select: { trades: true, comments: true } },
    },
  });
  if (!market) notFound();

  const me = await getAuthedUser();
  const yesPrice = priceYes({
    yesShares: market.yesShares,
    noShares: market.noShares,
  });

  const [positions, recentTrades, watching] = await Promise.all([
    me
      ? db.position.findMany({
          where: { userId: me.id, marketId: market.id },
          orderBy: { outcome: "asc" },
        })
      : Promise.resolve([]),
    db.trade.findMany({
      where: { marketId: market.id },
      orderBy: { createdAt: "desc" },
      take: 12,
      include: { user: { select: { username: true } } },
    }),
    me
      ? db.watchlist.findUnique({
          where: { userId_marketId: { userId: me.id, marketId: market.id } },
        })
      : Promise.resolve(null),
  ]);

  const resolved = market.status === "RESOLVED" || market.status === "CANCELLED";
  const endsAt = new Date(market.endsAt);

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-6 lg:grid-cols-[1fr_360px]">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge>{market.category}</Badge>
            {market.featured && <Badge tone="info">{tr("market.featured")}</Badge>}
            {resolved ? (
              <Badge
                tone={
                  market.resolvedAs === "YES"
                    ? "yes"
                    : market.resolvedAs === "NO"
                      ? "no"
                      : "warn"
                }
              >
                {market.status === "CANCELLED"
                  ? tr("market.cancelled")
                  : tr("market.resolvedOutcome", {
                      outcome: market.resolvedAs ?? "",
                    })}
              </Badge>
            ) : (
              <Badge tone="default">
                {tr("market.endsDate", { date: endsAt.toLocaleString(locale) })}
              </Badge>
            )}
            {me && (
              <WatchToggle
                marketId={market.id}
                initial={!!watching}
              />
            )}
            <ShareButton
              title={market.title}
              text={`${tr("market.yes")} ${(market.noShares / (market.yesShares + market.noShares)).toFixed(2)} · ${tr("market.no")} ${(market.yesShares / (market.yesShares + market.noShares)).toFixed(2)} on Kalki Exchange`}
            />
          </div>
          <h1 className="text-2xl font-black md:text-3xl">{market.title}</h1>
          <p className="mt-3 max-w-prose whitespace-pre-line text-sm text-slate-300">
            {market.description}
          </p>
          {market.resolutionSource && (
            <p className="mt-3 text-xs text-slate-500">
              <span className="font-semibold text-slate-400">
                {tr("market.resolutionSource")}
              </span>{" "}
              {market.resolutionSource}
            </p>
          )}
          {resolved && market.resolutionNote && (
            <p className="mt-3 rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-sm text-slate-300">
              <span className="font-semibold text-slate-100">
                {tr("market.resolution")}{" "}
              </span>
              {market.resolutionNote}
            </p>
          )}

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>{tr("market.priceHistory")}</CardTitle>
              <div className="flex items-baseline gap-3">
                <div className="text-3xl font-black text-emerald-300">
                  {fmtPrice(yesPrice)}
                </div>
                <div className="text-sm text-slate-500">{tr("market.yes")}</div>
              </div>
            </CardHeader>
            <PriceChart
              points={market.pricePoints.map((p) => ({
                t: p.recordedAt.getTime(),
                y: p.yesPrice,
              }))}
              fallbackY={yesPrice}
            />
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>{tr("market.recentTrades")}</CardTitle>
              <span className="text-xs text-slate-500">
                {tr("market.totalTrades", { count: market._count.trades })}
              </span>
            </CardHeader>
            <ul className="divide-y divide-slate-800">
              {recentTrades.length === 0 ? (
                <li className="py-3 text-sm text-slate-500">
                  {tr("market.noTrades")}
                </li>
              ) : (
                recentTrades.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Badge tone={t.outcome === "YES" ? "yes" : "no"}>
                        {t.outcome}
                      </Badge>
                      <span className="font-mono text-slate-400">
                        {t.user.username}
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="font-mono">
                        {fmtCoins(t.cost)}{" "}
                        <span className="text-slate-500">
                          {tr("toast.coins")}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {timeAgo(t.createdAt)}
                      </div>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>{tr("market.discussion")}</CardTitle>
              <span className="text-xs text-slate-500">
                {tr("market.commentsCount", { count: market._count.comments })}
              </span>
            </CardHeader>
            <Comments marketId={market.id} canPost={!!me} />
          </Card>
        </div>

        <div className="hidden space-y-3 lg:block">
          <MarketTradePanel
            marketId={market.id}
            slug={market.slug}
            yesShares={market.yesShares}
            noShares={market.noShares}
            status={market.status}
            authed={!!me}
            positions={positions.map((p) => ({
              outcome: p.outcome,
              shares: p.shares,
              costBasis: p.costBasis,
            }))}
          />
          <OrderBookLadder marketId={market.slug} outcome="YES" />
          <LimitOrderForm
            marketId={market.id}
            authed={!!me}
            marketOpen={market.status === "OPEN"}
            yesPosition={
              positions.find((p) => p.outcome === "YES") ?? undefined
            }
            noPosition={
              positions.find((p) => p.outcome === "NO") ?? undefined
            }
          />
          {me && <OpenOrdersPanel marketId={market.id} />}
          <Card>
            <CardTitle className="mb-2">{tr("market.marketStats")}</CardTitle>
            <Stat
              label={tr("market.volume")}
              value={`${fmtCoins(market.volumeCoins)} ${tr("toast.coins")}`}
            />
            <Stat
              label={tr("market.liquidity")}
              value={`${fmtCoins(Math.round(market.yesShares + market.noShares))} ${tr("market.shares")}`}
            />
            <Stat
              label={tr("market.midPrice")}
              value={`${fmtPrice(yesPrice)} ${tr("market.yes")} · ${fmtPrice(1 - yesPrice)} ${tr("market.no")}`}
            />
            <Stat label={tr("market.created")} value={timeAgo(market.createdAt)} />
          </Card>
        </div>
      </div>

      {/* Mobile-only sticky trade bar + bottom-sheet. Mirrors the right
          column's content so phone users get full trading parity. */}
      <div className="lg:hidden">
        <MobileTradeBar
          marketId={market.id}
          slug={market.slug}
          yesShares={market.yesShares}
          noShares={market.noShares}
          status={market.status}
          authed={!!me}
          positions={positions.map((p) => ({
            outcome: p.outcome,
            shares: p.shares,
            locked: p.locked,
            costBasis: p.costBasis,
          }))}
        />
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-t border-slate-800 py-2 text-sm first:border-t-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-mono text-slate-200">{value}</span>
    </div>
  );
}
