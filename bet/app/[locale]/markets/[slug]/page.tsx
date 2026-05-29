import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "../markets-v2.css";
import {
  ExchangeTopbar,
  ExchangeFooter,
  ExchangeBackdrop,
} from "@/components/ExchangeChrome";
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
  DEFAULT_LOCALE,
  buildLocalizedMetadata,
  formatCategory,
  formatResolvedAs,
  isLocale,
  marketTranslationInclude,
  resolveMarketContent,
  t,
  type Locale,
} from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const m = await db.market.findUnique({
    where: { slug },
    select: {
      title: true,
      description: true,
      yesShares: true,
      noShares: true,
      status: true,
      resolvedAs: true,
      translations: {
        where: { locale },
        select: { locale: true, title: true, description: true },
      },
    },
  });

  if (!m) {
    return buildLocalizedMetadata({
      locale,
      path: `/markets/${slug}`,
      title: t("market.notFound", locale),
      description: t("errors.notFoundDescription", locale),
      noindex: true,
    });
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
  const localized = resolveMarketContent(m, locale);
  const teaser = localized.description.split("\n")[0].slice(0, 180);

  return buildLocalizedMetadata({
    locale,
    path: `/markets/${slug}`,
    title: localized.title,
    description: `${priceTag} — ${teaser}`,
    ogType: "article",
  });
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
      ...marketTranslationInclude(locale),
    },
  });
  if (!market) notFound();
  const localized = resolveMarketContent(market, locale);

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
    <div className="mkt">
      <ExchangeBackdrop />
      <ExchangeTopbar active="markets" locale={locale} />

      <main className="page content">
        <div className="crumbs" style={{ marginBottom: 18 }}>
          <span>{tr("market.crumbTrade")}</span>
          <span className="sep">/</span>
          <span className="here">{formatCategory(market.category, locale)}</span>
        </div>

        <div className="detail-grid">
          {/* ── MAIN ── */}
          <div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 8,
                marginBottom: 14,
              }}
            >
              <span className={`cat ${catClass(market.category)}`}>
                {formatCategory(market.category, locale)}
              </span>
              {market.featured && (
                <span className="tag info">{tr("market.featured")}</span>
              )}
              {resolved ? (
                <span
                  className={`tag ${
                    market.resolvedAs === "YES"
                      ? "yes"
                      : market.resolvedAs === "NO"
                        ? "no"
                        : "warn"
                  }`}
                >
                  {market.status === "CANCELLED"
                    ? tr("market.cancelled")
                    : market.resolvedAs
                      ? formatResolvedAs(market.resolvedAs, locale)
                      : tr("market.resolved")}
                </span>
              ) : (
                <span className="tag">
                  {tr("market.endsDate", {
                    date: endsAt.toLocaleString(locale),
                  })}
                </span>
              )}
              {me && (
                <WatchToggle marketId={market.id} initial={!!watching} />
              )}
              <ShareButton
                title={localized.title}
                text={`${tr("market.yes")} ${(market.noShares / (market.yesShares + market.noShares)).toFixed(2)} · ${tr("market.no")} ${(market.yesShares / (market.yesShares + market.noShares)).toFixed(2)} on Kalki Exchange`}
              />
            </div>

            <h1
              className="page-title"
              style={{ fontSize: 32, marginTop: 0 }}
            >
              {localized.title}
            </h1>
            <p
              className="panel-sub"
              style={{ marginTop: 12, whiteSpace: "pre-line", maxWidth: "65ch" }}
            >
              {localized.description}
            </p>
            {market.resolutionSource && (
              <p className="panel-meta" style={{ marginTop: 12 }}>
                {tr("market.resolutionSource")} {market.resolutionSource}
              </p>
            )}
            {resolved && market.resolutionNote && (
              <p
                className="panel"
                style={{ marginTop: 12, padding: 14, fontSize: 13.5 }}
              >
                <strong>{tr("market.resolution")} </strong>
                {market.resolutionNote}
              </p>
            )}

            {/* Price history */}
            <section className="panel" style={{ marginTop: 20 }}>
              <div className="panel-head">
                <div className="panel-title">{tr("market.priceHistory")}</div>
                <div
                  style={{ display: "flex", alignItems: "baseline", gap: 10 }}
                >
                  <span className="price-xl">{fmtPrice(yesPrice)}</span>
                  <span className="panel-meta">{tr("market.yes")}</span>
                </div>
              </div>
              <PriceChart
                points={market.pricePoints.map((p) => ({
                  t: p.recordedAt.getTime(),
                  y: p.yesPrice,
                }))}
                fallbackY={yesPrice}
              />
            </section>

            {/* Recent trades */}
            <section className="panel" style={{ marginTop: 16 }}>
              <div className="panel-head">
                <div className="panel-title">{tr("market.recentTrades")}</div>
                <span className="panel-meta">
                  {tr("market.totalTrades", { count: market._count.trades })}
                </span>
              </div>
              {recentTrades.length === 0 ? (
                <p className="panel-sub">{tr("market.noTrades")}</p>
              ) : (
                <ul className="list">
                  {recentTrades.map((trade) => (
                    <li key={trade.id}>
                      <div
                        className="list-row"
                        style={{ alignItems: "center", justifyContent: "space-between" }}
                      >
                        <div
                          style={{ display: "flex", alignItems: "center", gap: 8 }}
                        >
                          <span
                            className={`tag ${trade.outcome === "YES" ? "yes" : "no"}`}
                          >
                            {trade.outcome}
                          </span>
                          <span
                            style={{
                              fontFamily: "var(--font-mono)",
                              fontSize: 12.5,
                              color: "var(--color-text-2)",
                            }}
                          >
                            {trade.user.username}
                          </span>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>
                            {fmtCoins(trade.cost)}{" "}
                            <span style={{ color: "var(--color-text-3)" }}>
                              {tr("toast.coins")}
                            </span>
                          </div>
                          <div className="list-time">
                            {timeAgo(trade.createdAt)}
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Discussion */}
            <section className="panel" style={{ marginTop: 16 }}>
              <div className="panel-head">
                <div className="panel-title">{tr("market.discussion")}</div>
                <span className="panel-meta">
                  {tr("market.commentsCount", {
                    count: market._count.comments,
                  })}
                </span>
              </div>
              <Comments marketId={market.id} canPost={!!me} />
            </section>
          </div>

          {/* ── SIDE RAIL (desktop) ── */}
          <aside className="detail-side">
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
              noPosition={positions.find((p) => p.outcome === "NO") ?? undefined}
            />
            {me && <OpenOrdersPanel marketId={market.id} />}
            <section className="panel">
              <div className="panel-head">
                <div className="panel-title">{tr("market.marketStats")}</div>
              </div>
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
              <Stat
                label={tr("market.created")}
                value={timeAgo(market.createdAt)}
              />
            </section>
          </aside>
        </div>
      </main>

      {/* Mobile-only sticky trade bar + bottom-sheet. */}
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

      <ExchangeFooter locale={locale} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="l">{label}</span>
      <span className="v">{value}</span>
    </div>
  );
}

function catClass(category: string): string {
  switch (category) {
    case "SPORTS":
      return "sports";
    case "POLITICS":
      return "politics";
    case "CRYPTO":
      return "crypto";
    case "TECH":
      return "tech";
    case "ENTERTAINMENT":
      return "ent";
    default:
      return "";
  }
}
