import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import "./portfolio-v2.css";
import { ThemeSwitch } from "../wallet/wallet-client";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { priceYes } from "@/lib/amm";
import { hubHomeUrl } from "@/lib/hub";
import { fmtCoins, fmtPrice, timeAgo } from "@/lib/utils";
import {
  DEFAULT_LOCALE,
  buildAuthRedirect,
  buildLocalizedMetadata,
  formatCategory,
  isLocale,
  localizedPath,
  marketTranslationInclude,
  resolveMarketContent,
  t,
  type Locale,
  type MarketCategory,
} from "@/lib/i18n";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const TF_DAYS: Record<string, number> = {
  "1d": 1,
  "7d": 7,
  "1m": 30,
  "3m": 90,
  "1y": 365,
  all: 3650,
};

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

/**
 * Portfolio — Portfolio v2 design (E:\kalki.bet-4\Portfolio.html), wired
 * to the real backend. Presentation changed wholesale; the data is all
 * real bet data: positions marked-to-market off live AMM prices, the
 * equity curve from PricePoint history of the current basket, allocation
 * by category, win-rate from resolved positions, the real daily streak,
 * achievements, and recent trades. Cross-app figures (Aviator/Auctions
 * live in the backend DB, not here) are intentionally not fabricated —
 * the "by product" card is replaced with real recent trades.
 *
 * Server component; the only client island is the shared ThemeSwitch.
 * Styles are isolated under a `.pf` root.
 */
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

  const sp = await searchParams;
  const pick = (v: string | string[] | undefined): string =>
    Array.isArray(v) ? (v[0] ?? "") : (v ?? "");

  const u = await getAuthedUser();
  if (!u) {
    redirect(buildAuthRedirect("/portfolio", sp, locale));
  }

  const tf = (pick(sp.tf) || "7d").toLowerCase();
  const tfDays = TF_DAYS[tf] ?? 7;
  const tab = (pick(sp.tab) || "open").toLowerCase() === "resolved" ? "resolved" : "open";

  const now = Date.now();
  const windowStart = now - tfDays * DAY_MS;
  const thirtyAgo = new Date(now - 30 * DAY_MS);
  const fourteenAgo = new Date(now - 14 * DAY_MS);

  const [me, wallet, allPositions, recentTrades, streakTrades, touched, achievements, unlocked] =
    await Promise.all([
      db.user.findUnique({
        where: { id: u.id },
        select: { username: true, streak: true, level: true },
      }),
      db.wallet.findUnique({ where: { userId: u.id }, select: { balance: true } }),
      db.position.findMany({
        where: { userId: u.id },
        include: { market: { include: marketTranslationInclude(locale) } },
        orderBy: { updatedAt: "desc" },
        take: 300,
      }),
      db.trade.findMany({
        where: { userId: u.id },
        orderBy: { createdAt: "desc" },
        take: 6,
        include: { market: { include: marketTranslationInclude(locale) } },
      }),
      db.trade.findMany({
        where: { userId: u.id, createdAt: { gte: fourteenAgo } },
        select: { createdAt: true },
      }),
      db.trade.findMany({
        where: { userId: u.id, createdAt: { gte: thirtyAgo } },
        select: { marketId: true },
        distinct: ["marketId"],
      }),
      db.achievement.findMany({
        orderBy: { sortOrder: "asc" },
        select: { id: true, code: true, title: true, icon: true },
      }),
      db.userAchievement.findMany({
        where: { userId: u.id },
        select: { achievementId: true },
      }),
    ]);

  const balance = wallet?.balance ?? 0;

  // Mark each position to market off the live AMM price (resolved → 1/0).
  const liveYes = (m: { yesShares: number; noShares: number }) =>
    priceYes({ yesShares: m.yesShares, noShares: m.noShares });
  const isResolved = (s: string) => s === "RESOLVED" || s === "CANCELLED";

  const enrichedAll = allPositions.map((p) => {
    const resolved = isResolved(p.market.status);
    const live = resolved
      ? p.market.resolvedAs === p.outcome
        ? 1
        : 0
      : p.outcome === "YES"
        ? liveYes(p.market)
        : 1 - liveYes(p.market);
    const value = Math.round(p.shares * live);
    const pnl = value - p.costBasis;
    return { ...p, resolved, livePrice: live, value, pnl };
  });

  const openPos = enrichedAll.filter((p) => !p.resolved && p.shares > 0);
  const resolvedPos = enrichedAll.filter((p) => p.resolved);

  let totalCostOpen = 0;
  let totalValueOpen = 0;
  const allocByCat = new Map<MarketCategory, number>();
  for (const p of openPos) {
    totalCostOpen += p.costBasis;
    totalValueOpen += p.value;
    allocByCat.set(p.market.category, (allocByCat.get(p.market.category) ?? 0) + p.value);
  }
  const unrealized = totalValueOpen - totalCostOpen;
  const realizedAll = enrichedAll.reduce((s, p) => s + p.realizedPnl, 0);
  const allTime = realizedAll + unrealized;
  const totalValue = balance + totalValueOpen;

  // Win rate + best/worst from resolved positions.
  let wins = 0;
  let losses = 0;
  let bestWin = 0;
  let worstLoss = 0;
  for (const p of resolvedPos) {
    if (p.realizedPnl > 0) wins++;
    else if (p.realizedPnl < 0) losses++;
    if (p.realizedPnl > bestWin) bestWin = p.realizedPnl;
    if (p.realizedPnl < worstLoss) worstLoss = p.realizedPnl;
  }
  const winRate = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : null;
  const categoriesUsed = allocByCat.size;
  const avgTicket = openPos.length > 0 ? Math.round(totalCostOpen / openPos.length) : 0;

  // ── Equity curve (current basket marked at historical prices) ──
  const openMarketIds = openPos.map((p) => p.marketId);
  const priceRows = openMarketIds.length
    ? await db.pricePoint.findMany({
        where: { marketId: { in: openMarketIds }, recordedAt: { gte: new Date(Math.min(windowStart, now - 2 * DAY_MS)) } },
        select: { marketId: true, yesPrice: true, recordedAt: true },
        orderBy: { recordedAt: "asc" },
        take: 6000,
      })
    : [];
  const seriesByMarket = new Map<string, { t: number; yes: number }[]>();
  for (const r of priceRows) {
    const arr = seriesByMarket.get(r.marketId);
    const point = { t: new Date(r.recordedAt).getTime(), yes: r.yesPrice };
    if (arr) arr.push(point);
    else seriesByMarket.set(r.marketId, [point]);
  }

  const priceAt = (p: (typeof openPos)[number], at: number): number => {
    const rows = seriesByMarket.get(p.marketId);
    if (!rows || rows.length === 0) return p.livePrice;
    let yes = rows[0].yes;
    for (const row of rows) {
      if (row.t <= at) yes = row.yes;
      else break;
    }
    return p.outcome === "YES" ? yes : 1 - yes;
  };

  const STEPS = 48;
  const equity: number[] = [];
  for (let i = 0; i < STEPS; i++) {
    const at = windowStart + ((now - windowStart) * i) / (STEPS - 1);
    let v = balance;
    for (const p of openPos) v += p.shares * priceAt(p, at);
    equity.push(v);
  }
  // 24h P&L on the current basket (cash cancels out).
  let mtm24 = 0;
  for (const p of openPos) mtm24 += p.shares * priceAt(p, now - DAY_MS);
  const pnl24 = Math.round(totalValueOpen - mtm24);
  const chart = buildEquityChart(equity);

  // ── Streak heatmap (last 14 days of trade activity) ──
  const dayCounts = new Array(14).fill(0);
  const startDay = new Date();
  startDay.setHours(0, 0, 0, 0);
  const startDayMs = startDay.getTime() - 13 * DAY_MS;
  for (const tx of streakTrades) {
    const idx = Math.floor((new Date(tx.createdAt).getTime() - startDayMs) / DAY_MS);
    if (idx >= 0 && idx < 14) dayCounts[idx]++;
  }

  // ── Achievements ──
  const unlockedIds = new Set(unlocked.map((a) => a.achievementId));
  const badges = achievements
    .slice()
    .sort((a, b) => Number(unlockedIds.has(b.id)) - Number(unlockedIds.has(a.id)))
    .slice(0, 9)
    .map((a) => ({ ...a, unlocked: unlockedIds.has(a.id) }));

  const username = me?.username ?? "user";
  const initial = username.slice(0, 1).toUpperCase();
  const tabList = tab === "resolved" ? resolvedPos : openPos;
  const shown = tabList.slice(0, 12);

  const tabHref = (which: "open" | "resolved") =>
    lp(`/portfolio${qs({ tf, tab: which })}`);
  const tfHref = (which: string) => lp(`/portfolio${qs({ tf: which, tab })}`);

  return (
    <div className="pf">
      <div className="bg-stack" aria-hidden="true">
        <div className="bg-mesh" />
        <div className="bg-grid" />
        <div className="bg-grain" />
      </div>

      {/* ── TOPBAR ── */}
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href={hubHomeUrl()} aria-label="Kalki Exchange">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-mark" src="/kalki-logo.png" alt="Kalki Exchange" width={34} height={34} />
          </a>
          <nav className="nav" aria-label="primary">
            <Link href={lp("/markets")}>{tr("nav.markets")}</Link>
            <Link className="active" href={lp("/portfolio")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" />
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
              </svg>
              {tr("nav.portfolio")}
            </Link>
            <Link href={lp("/watchlist")}>{tr("nav.watchlist")}</Link>
            <Link href={lp("/wallet")}>{tr("nav.wallet")}</Link>
          </nav>
          <div className="topbar-right">
            <span className="balance-pill"><span className="lbl">BAL</span> {fmtCoins(balance)}</span>
            <ThemeSwitch />
            <Link className="deposit-btn" href={lp("/wallet")}>+ {tr("wallet.buyCoins")}</Link>
            <div className="avatar">{initial}</div>
          </div>
        </div>
      </header>

      {/* ── STATUS STRIP (honest, real figures) ── */}
      <div className="status-strip">
        <div className="status-inner">
          <span className="live">{tr("portfolio.streakDays", { count: me?.streak ?? 0 })}</span>
          <span className="sep">·</span>
          <span>{tr("portfolio.openCount", { count: openPos.length })}</span>
          <span className="sep">·</span>
          <span style={{ color: allTime >= 0 ? "var(--emerald-300)" : "var(--rose-300)" }}>
            {allTime >= 0 ? "▲" : "▼"} {tr("portfolio.allTimeStrip", { amount: fmtSigned(allTime) })}
          </span>
        </div>
      </div>

      {/* ── PAGE ── */}
      <main className="page">
        <div className="page-head">
          <div>
            <div className="crumbs">
              <span>{tr("wallet.crumbAccount")}</span>
              <span className="sep">/</span>
              <span className="here">{tr("portfolio.heading")}</span>
            </div>
            <h1 className="page-title">
              {tr("portfolio.titleLead")} <em>{tr("portfolio.titleEm")}</em>
            </h1>
            <p className="page-sub">{tr("portfolio.subtitle")}</p>
          </div>
          <div className="page-stats">
            <div className="pstat"><div className="v cy">{fmtCoins(totalValue)}</div><div className="l">{tr("portfolio.totalValue")}</div></div>
            <div className="pstat"><div className={`v ${pnl24 >= 0 ? "pos" : "neg"}`}>{fmtSigned(pnl24)}</div><div className="l">{tr("portfolio.pnl24")}</div></div>
            <div className="pstat"><div className={`v ${allTime >= 0 ? "pos" : "neg"}`}>{fmtSigned(allTime)}</div><div className="l">{tr("portfolio.allTime")}</div></div>
            <div className="pstat"><div className="v">{winRate !== null ? `${winRate}%` : "—"}</div><div className="l">{tr("portfolio.winRate")}</div></div>
          </div>
        </div>

        <div className="layout">
          {/* ═══ MAIN ═══ */}
          <div className="col-main">
            {/* HERO */}
            <section className="hero-card">
              <div className="hero-top">
                <div className="hero-left">
                  <div className="hero-lbl">{tr("portfolio.valueLive")}</div>
                  <div className="hero-num"><span>{fmtCoins(totalValue)}</span><span className="unit">{tr("wallet.coins")}</span></div>
                  <div className="hero-delta">
                    <span className={`row ${pnl24 >= 0 ? "pos" : "neg"}`}>
                      <span className="pct">{pnl24 >= 0 ? "▲" : "▼"} {fmtSigned(pnl24)}</span>
                      <span className="label">{tr("portfolio.deltaH24")}</span>
                    </span>
                    <span className={`row ${allTime >= 0 ? "pos" : "neg"}`}>
                      <span className="pct">{allTime >= 0 ? "▲" : "▼"} {fmtSigned(allTime)}</span>
                      <span className="label">{tr("portfolio.deltaAllTime")}</span>
                    </span>
                    <span className="row"><span className="pct" style={{ color: "var(--cyan-200)" }}>{fmtCoins(balance)}</span><span className="label">{tr("portfolio.cash")}</span></span>
                    <span className="row"><span className="pct" style={{ color: "var(--cyan-200)" }}>{fmtCoins(totalValueOpen)}</span><span className="label">{tr("portfolio.inPositions")}</span></span>
                  </div>

                  <div className="tf-row">
                    {(["1d", "7d", "1m", "3m", "1y", "all"] as const).map((x) => (
                      <Link key={x} className={tf === x ? "on" : ""} href={tfHref(x)}>{x.toUpperCase()}</Link>
                    ))}
                  </div>

                  <div className="equity-chart">
                    <svg viewBox="0 0 700 180" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="rgba(var(--logo-a-rgb),0.45)" />
                          <stop offset="100%" stopColor="rgba(var(--logo-a-rgb),0)" />
                        </linearGradient>
                      </defs>
                      <line x1="0" y1="45" x2="700" y2="45" stroke="var(--chart-grid)" strokeDasharray="2 4" />
                      <line x1="0" y1="90" x2="700" y2="90" stroke="var(--chart-grid)" strokeDasharray="2 4" />
                      <line x1="0" y1="135" x2="700" y2="135" stroke="var(--chart-grid)" strokeDasharray="2 4" />
                      <path d={chart.area} fill="url(#eqGrad)" />
                      <path d={chart.line} fill="none" stroke="var(--cyan-400)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                      <circle cx="700" cy={chart.lastY} r="4" fill="var(--cyan-400)" />
                      <circle cx="700" cy={chart.lastY} r="8" fill="none" stroke="var(--cyan-400)" strokeWidth="1" opacity="0.4" />
                    </svg>
                    <div className="y-lbls">
                      {chart.yLabels.map((y, i) => (<span key={i}>{fmtCoins(y)}</span>))}
                    </div>
                  </div>
                  <div className="x-lbls">
                    <span>{fmtDay(windowStart, locale)}</span>
                    <span>{fmtDay(windowStart + (now - windowStart) / 2, locale)}</span>
                    <span>{tr("portfolio.today")}</span>
                  </div>
                </div>

                <div className="hero-right">
                  <div className="hero-lbl">{tr("portfolio.snapshot")}</div>
                  <div className="mini-stats">
                    <div className="mini"><div className="l">{tr("portfolio.openPositions")}</div><div className="v">{openPos.length}</div><div className="delta">{tr("portfolio.acrossCats", { count: categoriesUsed })}</div></div>
                    <div className="mini"><div className="l">{tr("portfolio.avgTicket")}</div><div className="v">{fmtCoins(avgTicket)}</div><div className="delta">{tr("wallet.coins")}</div></div>
                    <div className="mini"><div className="l">{tr("portfolio.bestWin")}</div><div className="v pos">{bestWin > 0 ? fmtSigned(bestWin) : "—"}</div><div className="delta">{tr("portfolio.realized")}</div></div>
                    <div className="mini"><div className="l">{tr("portfolio.worstLoss")}</div><div className="v neg">{worstLoss < 0 ? fmtSigned(worstLoss) : "—"}</div><div className="delta">{tr("portfolio.realized")}</div></div>
                    <div className="mini"><div className="l">{tr("portfolio.realizedPnl")}</div><div className={`v ${realizedAll >= 0 ? "pos" : "neg"}`}>{fmtSigned(realizedAll)}</div><div className="delta">{tr("portfolio.allTimeLc")}</div></div>
                    <div className="mini"><div className="l">{tr("portfolio.marketsTouched")}</div><div className="v">{touched.length}</div><div className="delta">{tr("portfolio.last30d")}</div></div>
                  </div>
                  <div className="hero-cta-row">
                    <Link className="btn primary" href={lp("/markets")}>{tr("portfolio.goToMarkets")} →</Link>
                    <Link className="btn ghost" href={lp("/wallet")}>{tr("nav.wallet")}</Link>
                  </div>
                </div>
              </div>
            </section>

            {/* ALLOCATION */}
            <section className="card">
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">{tr("portfolio.eyebrowAllocation")}</div>
                  <div className="card-title">{tr("portfolio.allocationTitle", { amount: fmtCoins(totalValueOpen) })}</div>
                </div>
                <Link className="small-link" href={lp("/markets")}>{tr("portfolio.findMarkets")} →</Link>
              </div>
              <div className="alloc">
                {totalValueOpen > 0 ? (
                  <>
                    <div className="alloc-bar">
                      {[...allocByCat.entries()]
                        .sort((a, b) => b[1] - a[1])
                        .map(([cat, val]) => (
                          <span key={cat} style={{ width: `${(val / totalValueOpen) * 100}%`, background: catColor(cat) }} />
                        ))}
                    </div>
                    <div className="alloc-legend">
                      {[...allocByCat.entries()]
                        .sort((a, b) => b[1] - a[1])
                        .map(([cat, val]) => (
                          <span className="leg" key={cat}>
                            <span className="sw" style={{ background: catColor(cat) }} />
                            {formatCategory(cat, locale)}
                            <span className="val">{fmtCoins(val)}</span>
                            <span className="pct">· {Math.round((val / totalValueOpen) * 100)}%</span>
                          </span>
                        ))}
                    </div>
                  </>
                ) : (
                  <div className="alloc-empty">{tr("portfolio.noExposure")}</div>
                )}
              </div>
            </section>

            {/* POSITIONS */}
            <section className="card pos-card">
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">{tr("portfolio.eyebrowPositions")}</div>
                  <div className="card-title">{tab === "resolved" ? tr("portfolio.resolvedPositions") : tr("portfolio.openPositions")}</div>
                </div>
              </div>
              <div className="tabs-row">
                <Link className={tab === "open" ? "on" : ""} href={tabHref("open")}>
                  {tr("portfolio.tabOpen")} <span className="n">{openPos.length}</span>
                </Link>
                <Link className={tab === "resolved" ? "on" : ""} href={tabHref("resolved")}>
                  {tr("portfolio.tabResolved")} <span className="n">{resolvedPos.length}</span>
                </Link>
              </div>

              {shown.length === 0 ? (
                <div className="pos-empty">
                  {tab === "resolved" ? (
                    tr("portfolio.noResolved")
                  ) : (
                    <Link href={lp("/markets")}>{tr("portfolio.noPositions")}</Link>
                  )}
                </div>
              ) : (
                <>
                  <div className="pos-thead">
                    <div />
                    <div>{tr("portfolio.colMarket")}</div>
                    <div className="right">{tr("portfolio.colStake")}</div>
                    <div className="right">{tr("portfolio.colAvg")}</div>
                    <div className="right">{tr("portfolio.colMark")}</div>
                    <div className="right">{tr("portfolio.colValue")}</div>
                    <div className="right">{tr("portfolio.colPnl")}</div>
                    <div />
                  </div>
                  {shown.map((p) => {
                    const content = resolveMarketContent(p.market, locale);
                    const avg = p.shares > 0 ? p.costBasis / p.shares : 0;
                    const pct = p.costBasis > 0 ? Math.round((p.pnl / p.costBasis) * 100) : 0;
                    return (
                      <div className="pos-row" key={p.id}>
                        <div className={`side-icon ${p.outcome === "YES" ? "y" : "n"}`}>{p.outcome}</div>
                        <div className="pos-q">
                          <Link className="label" href={lp(`/markets/${p.market.slug}`)}>{content.title}</Link>
                          <div className="sub">
                            <span className={`cat ${catClass(p.market.category)}`}>{formatCategory(p.market.category, locale)}</span>
                            <span>{p.resolved ? tr("market.resolved") : tr("market.endsDate", { date: fmtDay(new Date(p.market.endsAt).getTime(), locale) })}</span>
                          </div>
                        </div>
                        <div className="pos-num right hide-sm"><strong>{fmtCoins(Math.round(p.shares))}</strong> {tr("market.shares")}</div>
                        <div className="pos-num right hide-sm">{fmtPrice(avg)}</div>
                        <div className="pos-num right hide-sm" style={{ color: "var(--cyan-200)" }}>{fmtPrice(p.livePrice)}</div>
                        <div className="pos-num right hide-sm"><strong>{fmtCoins(p.value)}</strong></div>
                        <div className={`pos-pl ${p.pnl >= 0 ? "pos" : "neg"}`}>
                          {fmtSigned(p.pnl)}
                          <span className="pct">{p.pnl >= 0 ? "+" : "−"}{Math.abs(pct)}%</span>
                        </div>
                        <div className="hide-sm">
                          <Link className="pos-action" href={lp(`/markets/${p.market.slug}`)}>
                            {p.resolved ? tr("portfolio.view") : tr("portfolio.close")}
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                  <div className="pos-foot">
                    <span>{tr("portfolio.showingPositions", { shown: shown.length, total: tabList.length })}</span>
                    <Link className="small-link" href={lp("/markets")}>{tr("portfolio.findMarkets")} →</Link>
                  </div>
                </>
              )}
            </section>
          </div>

          {/* ═══ SIDE ═══ */}
          <aside className="col-side">
            {/* STREAK */}
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">{tr("portfolio.eyebrowStreak")}</div>
                  <div className="card-title">{tr("portfolio.dailyActivity")}</div>
                </div>
              </div>
              <div className="streak">
                <div className="streak-head">
                  <span className="streak-num">{me?.streak ?? 0}</span>
                  <span className="streak-lbl">{tr("portfolio.daysInARow")} 🔥</span>
                </div>
                <div className="streak-cells">
                  {dayCounts.map((c, i) => (
                    <span key={i} className={`c ${c >= 6 ? "l3" : c >= 3 ? "l2" : c >= 1 ? "l1" : ""}`} />
                  ))}
                </div>
                <div className="streak-foot"><span>{tr("portfolio.daysAgo14")}</span><span>{tr("portfolio.today")}</span></div>
              </div>
            </div>

            {/* RECENT TRADES (real bet data; replaces cross-app "by product") */}
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">{tr("portfolio.eyebrowActivity")}</div>
                  <div className="card-title">{tr("portfolio.recentTrades")}</div>
                </div>
                <Link className="small-link" href={lp("/wallet")}>{tr("wallet.fullLedger")} →</Link>
              </div>
              <div className="breakdown">
                {recentTrades.length === 0 ? (
                  <div className="bd-empty">{tr("portfolio.noTrades")}</div>
                ) : (
                  recentTrades.map((tx) => {
                    const content = resolveMarketContent(tx.market, locale);
                    return (
                      <div className="bd-row" key={tx.id}>
                        <div className={`icon ${tx.outcome === "YES" ? "y" : "n"}`}>{tx.outcome}</div>
                        <div className="meta">
                          <Link className="name" href={lp(`/markets/${tx.market.slug}`)}>{content.title}</Link>
                          <div className="sub">{timeAgo(tx.createdAt)} · @ {fmtPrice(tx.pricePerShare)}</div>
                        </div>
                        <div className="val">
                          {tx.cost >= 0 ? "−" : "+"}{fmtCoins(Math.abs(tx.cost))}
                          <span className="delta">{fmtCoins(Math.round(tx.shares))} {tr("market.shares")}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* BADGES */}
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">{tr("portfolio.eyebrowBadges")}</div>
                  <div className="card-title">{tr("portfolio.badgesUnlocked", { n: unlockedIds.size, total: achievements.length })}</div>
                </div>
                <Link className="small-link" href={lp("/achievements")}>{tr("portfolio.viewAll")} →</Link>
              </div>
              <div className="badges-grid">
                {badges.length === 0 ? (
                  <div className="bd-empty" style={{ gridColumn: "1 / -1" }}>{tr("portfolio.noBadges")}</div>
                ) : (
                  badges.map((b) => (
                    <div key={b.id} className={`badge ${b.unlocked ? "unlocked" : "locked"}`} title={b.title}>
                      <span className="ic">{b.unlocked ? badgeIcon(b.icon) : "🔒"}</span>
                      <span className="nm">{b.title}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>
        </div>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <span>{tr("portfolio.footerBrand")}</span>
          <span>{tr("market.footerCompliance")}</span>
          <span>{tr("wallet.needHelp")} <Link href={lp("/profile")}>{tr("profile.heading")}</Link></span>
        </div>
      </footer>
    </div>
  );
}

/* ── helpers ───────────────────────────────────────────────── */

function qs(o: { tf: string; tab: string }): string {
  const parts: string[] = [];
  if (o.tf && o.tf !== "7d") parts.push(`tf=${o.tf}`);
  if (o.tab && o.tab !== "open") parts.push(`tab=${o.tab}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

function fmtSigned(n: number): string {
  return `${n >= 0 ? "+" : "−"}${fmtCoins(Math.abs(n))}`;
}

function fmtDay(ms: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(ms));
}

function catClass(category: MarketCategory): string {
  switch (category) {
    case "SPORTS": return "sports";
    case "POLITICS": return "politics";
    case "CRYPTO": return "crypto";
    case "TECH": return "tech";
    case "ENTERTAINMENT": return "ent";
    default: return "";
  }
}

function catColor(category: MarketCategory): string {
  switch (category) {
    case "SPORTS": return "#FCD34D";
    case "POLITICS": return "#C7D2FE";
    case "CRYPTO": return "var(--logo-a)";
    case "TECH": return "#F0ABFC";
    case "ENTERTAINMENT": return "#FDA4AF";
    default: return "rgba(255,255,255,0.18)";
  }
}

/** Render an achievement icon: emoji as-is, lucide/ascii names → trophy. */
function badgeIcon(icon: string): string {
  if (!icon) return "🏆";
  // Any non-ASCII codepoint → treat as an emoji and render directly.
  return /[^ -]/.test(icon) ? icon : "🏆";
}

/** Build the equity-curve SVG paths (700×180 viewBox) + y-axis labels. */
function buildEquityChart(values: number[]): {
  line: string;
  area: string;
  lastY: number;
  yLabels: number[];
} {
  const w = 700;
  const top = 12;
  const bottom = 168;
  let vals = values.length >= 2 ? values : [values[0] ?? 0, values[0] ?? 0];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const n = vals.length;
  const coords = vals.map((v, i) => {
    const x = (i / (n - 1)) * w;
    const y = top + (1 - (v - min) / span) * (bottom - top);
    return [x, y] as const;
  });
  const line = "M" + coords.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L");
  const area = `${line} L${w} 180 L0 180 Z`;
  const lastY = coords[coords.length - 1][1];
  const yLabels = [max, min + span * (2 / 3), min + span / 3, min].map((v) => Math.round(v));
  return { line, area, lastY, yLabels };
}
