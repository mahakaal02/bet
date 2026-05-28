import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import "./markets-v2.css";
import { ThemeSwitch } from "../wallet/wallet-client";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { priceYes } from "@/lib/amm";
import { hubHomeUrl } from "@/lib/hub";
import { fmtCoins, fmtPrice } from "@/lib/utils";
import {
  DEFAULT_LOCALE,
  buildLocalizedMetadata,
  formatCategory,
  isLocale,
  listCategories,
  localizedPath,
  marketTranslationInclude,
  resolveMarketContent,
  t,
  type Locale,
  type MarketCategory,
} from "@/lib/i18n";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  return buildLocalizedMetadata({
    locale,
    path: "/markets",
    title: t("meta.marketsTitle", locale),
    description: t("meta.marketsDescription", locale),
  });
}

/**
 * Markets — Markets v2 design (E:\kalki.bet-3\Markets v2.html), wired to
 * the real backend. Presentation changed wholesale; the data flow is the
 * same query-param-driven SSR as before (q / cat / sort / status) plus a
 * featured hero and per-card sparklines built from real PricePoint rows.
 * No API routes or DB shapes were touched. Page stays a server component;
 * the only client island is the shared ThemeSwitch.
 */
export default async function MarketsPage({
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
  const pickString = (v: string | string[] | undefined): string =>
    Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
  const q = pickString(sp.q).trim();
  const cat = (pickString(sp.cat) || "ALL").toUpperCase();
  const sort = pickString(sp.sort) || "trending";
  const status = (pickString(sp.status) || "OPEN").toUpperCase();

  const categories = [
    { value: "ALL" as const, label: tr("market.categoryAll") },
    ...listCategories(locale),
  ];
  const validCat = categories.find((c) => c.value === cat)?.value ?? "ALL";

  // The featured hero only shows on the default browse view (no search,
  // open status, all categories) — filtered/searched views go straight
  // to the grid so the result set stays honest.
  const showFeatured = !q && status === "OPEN" && validCat === "ALL";

  const orderBy: Prisma.MarketOrderByWithRelationInput =
    sort === "volume"
      ? { volumeCoins: "desc" }
      : sort === "ending"
        ? { endsAt: "asc" }
        : sort === "new"
          ? { createdAt: "desc" }
          : { trendingScore: "desc" };

  const where: Prisma.MarketWhereInput = {
    ...(status !== "ALL" && {
      status: status as "OPEN" | "RESOLVED" | "CLOSED" | "CANCELLED",
    }),
    ...(validCat !== "ALL" && { category: validCat as MarketCategory }),
    ...(q && {
      OR: [
        { title: { contains: q, mode: "insensitive" as const } },
        { description: { contains: q, mode: "insensitive" as const } },
        {
          translations: {
            some: {
              locale,
              OR: [
                { title: { contains: q, mode: "insensitive" as const } },
                { description: { contains: q, mode: "insensitive" as const } },
              ],
            },
          },
        },
      ],
    }),
  };

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const u = await getAuthedUser();

  const [
    markets,
    featuredRaw,
    wallet,
    me,
    openCount,
    resolvedCount,
    newTodayCount,
    volAgg,
    catCounts,
    filteredCount,
  ] = await Promise.all([
    db.market.findMany({
      where,
      include: marketTranslationInclude(locale),
      orderBy,
      take: 60,
    }),
    showFeatured
      ? db.market.findFirst({
          where: { status: "OPEN" },
          orderBy: [{ featured: "desc" }, { trendingScore: "desc" }],
          include: {
            pricePoints: { orderBy: { recordedAt: "desc" }, take: 60 },
            _count: { select: { trades: true } },
            ...marketTranslationInclude(locale),
          },
        })
      : Promise.resolve(null),
    u
      ? db.wallet.findUnique({ where: { userId: u.id }, select: { balance: true } })
      : Promise.resolve(null),
    u
      ? db.user.findUnique({ where: { id: u.id }, select: { username: true } })
      : Promise.resolve(null),
    db.market.count({ where: { status: "OPEN" } }),
    db.market.count({ where: { status: "RESOLVED" } }),
    db.market.count({ where: { createdAt: { gte: startOfToday } } }),
    db.market.aggregate({ _sum: { volumeCoins: true } }),
    db.market.groupBy({
      by: ["category"],
      where: { ...(status !== "ALL" && { status: status as "OPEN" } ) },
      _count: { _all: true },
    }),
    db.market.count({ where }),
  ]);

  const featured = showFeatured ? featuredRaw : null;
  const gridMarkets = featured
    ? markets.filter((m) => m.id !== featured.id)
    : markets;
  const gridIds = gridMarkets.map((m) => m.id);

  // One bounded query for every visible card's recent price series —
  // grouped + downsampled in JS so the sparklines are real, not faked.
  const sparkWindow = new Date(Date.now() - 45 * DAY_MS);
  const sparkRows = gridIds.length
    ? await db.pricePoint.findMany({
        where: { marketId: { in: gridIds }, recordedAt: { gte: sparkWindow } },
        select: { marketId: true, yesPrice: true },
        orderBy: { recordedAt: "desc" },
        take: 8000,
      })
    : [];
  const sparkByMarket = new Map<string, number[]>();
  for (const r of sparkRows) {
    // rows arrive newest→oldest; unshift to rebuild oldest→newest
    const arr = sparkByMarket.get(r.marketId);
    if (arr) arr.unshift(r.yesPrice);
    else sparkByMarket.set(r.marketId, [r.yesPrice]);
  }

  const totalVol = volAgg._sum.volumeCoins ?? 0;
  const catCountMap = new Map<string, number>();
  let catCountAll = 0;
  for (const c of catCounts) {
    catCountMap.set(c.category, c._count._all);
    catCountAll += c._count._all;
  }

  const username = me?.username ?? null;
  const initial = (username ?? "?").slice(0, 1).toUpperCase();
  const balance = wallet?.balance ?? 0;

  return (
    <div className="mkt">
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
            <Link className="active" href={lp("/markets")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v18h18" />
                <path d="M7 14l4-4 4 4 6-6" />
              </svg>
              {tr("nav.markets")}
              {openCount > 0 && <span className="badge">{openCount}</span>}
            </Link>
            <Link href={lp("/portfolio")}>{tr("nav.portfolio")}</Link>
            <Link href={lp("/watchlist")}>{tr("nav.watchlist")}</Link>
            <Link href={lp("/wallet")}>{tr("nav.wallet")}</Link>
          </nav>

          <div className="topbar-right">
            {u ? (
              <>
                <span className="balance-pill">
                  <span className="lbl">BAL</span> {fmtCoins(balance)}
                </span>
                <ThemeSwitch />
                <Link className="deposit-btn" href={lp("/wallet")}>
                  + {tr("wallet.buyCoins")}
                </Link>
                <div className="avatar">{initial}</div>
              </>
            ) : (
              <>
                <ThemeSwitch />
                <Link className="deposit-btn" href={lp("/wallet")}>
                  {tr("nav.signIn")}
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── STATUS STRIP (honest, real figures only) ── */}
      <div className="status-strip">
        <div className="status-inner">
          <span className="live">{tr("market.liveMarkets", { count: openCount })}</span>
          <span className="sep">·</span>
          <span>{tr("market.openInterest", { coins: fmtCoins(totalVol) })}</span>
          <span className="sep">·</span>
          <span>{tr("market.settleFast")}</span>
        </div>
      </div>

      {/* ── PAGE ── */}
      <main className="page">
        <div className="page-head">
          <div>
            <div className="crumbs">
              <span>{tr("market.crumbTrade")}</span>
              <span className="sep">/</span>
              <span className="here">{tr("market.heading")}</span>
            </div>
            <h1 className="page-title">
              {tr("market.titleLead")} <em>{tr("market.titleEm")}</em>
            </h1>
            <p className="page-sub">{tr("market.subtitle")}</p>
          </div>
          <div className="page-stats">
            <div className="pstat">
              <div className="v">{openCount}</div>
              <div className="l">{tr("market.statOpen")}</div>
            </div>
            <div className="pstat">
              <div className="v cy">{fmtCoins(totalVol)}</div>
              <div className="l">{tr("market.statVolume")}</div>
            </div>
            <div className="pstat">
              <div className="v" style={{ color: "var(--emerald-300)" }}>
                {newTodayCount > 0 ? `+${newTodayCount}` : "0"}
              </div>
              <div className="l">{tr("market.statNewToday")}</div>
            </div>
            <div className="pstat">
              <div className="v">{resolvedCount}</div>
              <div className="l">{tr("market.statResolved")}</div>
            </div>
          </div>
        </div>

        {/* ── FEATURED MARKET ── */}
        {featured &&
          (() => {
            const fp = priceYes({
              yesShares: featured.yesShares,
              noShares: featured.noShares,
            });
            const series = (featured.pricePoints ?? [])
              .map((p) => p.yesPrice)
              .reverse(); // stored newest→oldest, want oldest→newest
            const chart = buildFeaturedChart(series, fp);
            const fc = resolveMarketContent(featured, locale);
            const pctYes = Math.round(fp * 100);
            const liq = Math.round(featured.yesShares + featured.noShares);
            const urgent = isUrgent(featured.endsAt);
            return (
              <section className="featured">
                <div className="featured-left">
                  <div className="featured-tags">
                    <span className={`cat ${catClass(featured.category)}`}>
                      {formatCategory(featured.category, locale)}
                    </span>
                    <span
                      className="cat"
                      style={{
                        background: "rgba(34,211,238,0.10)",
                        color: "var(--cyan-200)",
                        borderColor: "rgba(34,211,238,0.32)",
                      }}
                    >
                      ★ {tr("market.featured")}
                    </span>
                    <span className={`ends ${urgent ? "urgent" : ""}`}>
                      <ClockIcon />
                      {tr("market.endsDate", { date: endsLabel(featured.endsAt, locale) })}
                    </span>
                  </div>
                  <h2 className="featured-q">{fc.title}</h2>
                  <div className="featured-meta">
                    <span>
                      {tr("market.volume")} <strong>{fmtCoins(featured.volumeCoins)}</strong>
                    </span>
                    <span>
                      {tr("market.liquidity")} <strong>{fmtCoins(liq)}</strong>
                    </span>
                    <span>
                      {tr("market.trades")} <strong>{featured._count.trades}</strong>
                    </span>
                    {chart.changePct !== null && (
                      <span style={{ color: chart.up ? "var(--emerald-300)" : "var(--rose-300)" }}>
                        {chart.up ? "▲" : "▼"} {chart.up ? "+" : "−"}
                        {Math.abs(chart.changePct)}%
                      </span>
                    )}
                  </div>
                  <div className="featured-chart">
                    <svg viewBox="0 0 600 120" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="fcGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={chart.up ? "rgba(16,185,129,0.45)" : "rgba(244,63,94,0.45)"} />
                          <stop offset="100%" stopColor={chart.up ? "rgba(16,185,129,0)" : "rgba(244,63,94,0)"} />
                        </linearGradient>
                      </defs>
                      <line x1="0" y1="30" x2="600" y2="30" stroke="rgba(255,255,255,0.05)" strokeDasharray="2 4" />
                      <line x1="0" y1="60" x2="600" y2="60" stroke="rgba(255,255,255,0.05)" strokeDasharray="2 4" />
                      <line x1="0" y1="90" x2="600" y2="90" stroke="rgba(255,255,255,0.05)" strokeDasharray="2 4" />
                      <path d={chart.area} fill="url(#fcGrad)" />
                      <path d={chart.line} fill="none" stroke={chart.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                      <circle cx={chart.lastX} cy={chart.lastY} r="3.5" fill={chart.color} />
                      <circle cx={chart.lastX} cy={chart.lastY} r="7" fill="none" stroke={chart.color} strokeWidth="1" opacity="0.4" />
                      <text x="6" y="14" fill="rgba(245,247,255,0.34)" fontSize="9" fontFamily="JetBrains Mono">95</text>
                      <text x="6" y="64" fill="rgba(245,247,255,0.34)" fontSize="9" fontFamily="JetBrains Mono">50</text>
                      <text x="6" y="114" fill="rgba(245,247,255,0.34)" fontSize="9" fontFamily="JetBrains Mono">0</text>
                    </svg>
                  </div>
                </div>

                <div className="featured-right">
                  <div className="featured-yn">
                    <Link className="yn-row yes" href={lp(`/markets/${featured.slug}`)}>
                      <span className="yn-tag yes">{tr("market.yes")}</span>
                      <div className="yn-meta">
                        <div className="lbl">{tr("market.paysIfYes")}</div>
                        <div className="pay">{tr("market.payoutLine", { mult: payoutMult(fp) })}</div>
                      </div>
                      <div className="yn-price">{fmtPrice(fp)}</div>
                    </Link>
                    <Link className="yn-row no" href={lp(`/markets/${featured.slug}`)}>
                      <span className="yn-tag no">{tr("market.no")}</span>
                      <div className="yn-meta">
                        <div className="lbl">{tr("market.paysIfNo")}</div>
                        <div className="pay">{tr("market.payoutLine", { mult: payoutMult(1 - fp) })}</div>
                      </div>
                      <div className="yn-price">{fmtPrice(1 - fp)}</div>
                    </Link>
                  </div>

                  <div className="probrow">
                    <span className="y">{tr("market.pctYes", { pct: pctYes })}</span>
                    <span className="n">{tr("market.pctNo", { pct: 100 - pctYes })}</span>
                  </div>
                  <div className="probbar">
                    <div className="y" style={{ width: `${pctYes}%` }} />
                    <div className="n" style={{ width: `${100 - pctYes}%` }} />
                  </div>

                  <Link className="deposit-btn" href={lp(`/markets/${featured.slug}`)} style={{ marginTop: "6px", textAlign: "center" }}>
                    {tr("market.openMarket")} →
                  </Link>
                </div>
              </section>
            );
          })()}

        {/* ── FILTERS ── */}
        <div className="filterbar">
          <form className="search" method="get" action={lp("/markets")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input name="q" defaultValue={q} placeholder={tr("market.searchPlaceholder")} />
            {validCat !== "ALL" && <input type="hidden" name="cat" value={validCat} />}
            {sort !== "trending" && <input type="hidden" name="sort" value={sort} />}
            {status !== "OPEN" && <input type="hidden" name="status" value={status} />}
            <span className="kbd">↵</span>
          </form>

          <div className="tabs" role="tablist" aria-label={tr("market.statusFilterLabel")}>
            {(["OPEN", "RESOLVED", "ALL"] as const).map((s) => (
              <Link
                key={s}
                className={status === s ? "on" : ""}
                href={lp(`/markets${buildQs({ q, cat: validCat, sort, status }, { status: s })}`)}
              >
                {s === "OPEN" ? tr("market.filterOpen") : s === "RESOLVED" ? tr("market.filterResolved") : tr("market.filterAll")}
              </Link>
            ))}
          </div>

          <div className="filter-divider" />

          <div className="tabs" role="tablist" aria-label={tr("market.sortLabel")}>
            {(["trending", "volume", "ending", "new"] as const).map((s) => (
              <Link
                key={s}
                className={sort === s ? "on" : ""}
                href={lp(`/markets${buildQs({ q, cat: validCat, sort, status }, { sort: s })}`)}
              >
                {s === "trending" ? tr("market.sortTrending") : s === "volume" ? tr("market.sortVolume") : s === "ending" ? tr("market.sortEnding") : tr("market.sortNewest")}
              </Link>
            ))}
          </div>

          <div className="filter-divider" />

          <div className="chips">
            {categories.map((c) => {
              const active = c.value === validCat;
              const n = c.value === "ALL" ? catCountAll : catCountMap.get(c.value) ?? 0;
              return (
                <Link
                  key={c.value}
                  className={`chip ${active ? "on" : ""}`}
                  href={lp(`/markets${buildQs({ q, cat: validCat, sort, status }, { cat: c.value })}`)}
                >
                  {c.label} <span className="n">{n}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* ── SECTION HEAD + GRID ── */}
        {markets.length === 0 ? (
          <div className="empty">{tr("market.noMatches")}</div>
        ) : (
          <>
            <div className="section-head">
              <div className="section-h">
                {tr("market.topMarkets")}
                <span className="n">{tr("market.openCountLabel", { count: openCount })}</span>
              </div>
              <div className="crumbs" style={{ fontFamily: "var(--font-mono)" }}>
                {tr("market.sortedByLive", { sort: sortName(sort, tr) })}
              </div>
            </div>

            {gridMarkets.length > 0 ? (
              <div className="grid">
                {gridMarkets.map((m) => {
                  const p = priceYes({ yesShares: m.yesShares, noShares: m.noShares });
                  const localized = resolveMarketContent(m, locale);
                  const series = sparkByMarket.get(m.id) ?? [];
                  const spark = buildSpark(series, p);
                  const urgent = isUrgent(m.endsAt);
                  const resolved = m.status === "RESOLVED" || m.status === "CANCELLED";
                  return (
                    <Link className="market" key={m.id} href={lp(`/markets/${m.slug}`)}>
                      <div className="market-top">
                        <span className={`cat ${catClass(m.category)}`}>
                          {formatCategory(m.category, locale)}
                        </span>
                        <span className={`ends ${urgent ? "urgent" : ""}`}>
                          <ClockIcon />
                          {resolved
                            ? tr("market.resolved")
                            : endsLabel(m.endsAt, locale)}
                        </span>
                      </div>
                      <div className="q">{localized.title}</div>
                      <div className="yn">
                        <span className="ynbtn y">
                          <span className="l">{tr("market.yes")}</span>
                          <span className="p">{fmtPrice(p)}</span>
                        </span>
                        <span className="ynbtn n">
                          <span className="l">{tr("market.no")}</span>
                          <span className="p">{fmtPrice(1 - p)}</span>
                        </span>
                      </div>
                      <div className="market-foot">
                        <div className="lhs">
                          <span>{tr("market.vol")} <strong>{fmtCoins(m.volumeCoins)}</strong></span>
                          <span>{tr("market.liq")} <strong>{fmtCoins(Math.round(m.yesShares + m.noShares))}</strong></span>
                        </div>
                        <svg className="spark" viewBox="0 0 60 18" preserveAspectRatio="none">
                          <path d={spark.path} stroke={spark.color} strokeWidth="1.5" fill="none" />
                        </svg>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="empty">{tr("market.onlyFeatured")}</div>
            )}

            <div className="load-more">
              <span className="n">
                {tr("market.showingCount", {
                  shown: Math.min(filteredCount, gridMarkets.length + (featured ? 1 : 0)),
                  total: filteredCount,
                })}
              </span>
            </div>
          </>
        )}
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <span>{tr("market.footerBrand")}</span>
          <span>{tr("market.footerCompliance")}</span>
          <span>
            {tr("wallet.needHelp")} <Link href={lp("/profile")}>{tr("profile.heading")}</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

/* ── helpers ───────────────────────────────────────────────── */

function buildQs(
  base: { q: string; cat: string; sort: string; status: string },
  over: Partial<{ q: string; cat: string; sort: string; status: string }>,
): string {
  const m = { ...base, ...over };
  const parts: string[] = [];
  if (m.q) parts.push(`q=${encodeURIComponent(m.q)}`);
  if (m.cat && m.cat !== "ALL") parts.push(`cat=${m.cat}`);
  if (m.sort && m.sort !== "trending") parts.push(`sort=${m.sort}`);
  if (m.status && m.status !== "OPEN") parts.push(`status=${m.status}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

function catClass(category: MarketCategory): string {
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

function isUrgent(endsAt: Date): boolean {
  return new Date(endsAt).getTime() - Date.now() < 7 * DAY_MS;
}

function endsLabel(endsAt: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "2-digit",
  }).format(new Date(endsAt));
}

function payoutMult(price: number): string {
  if (price <= 0) return "—";
  return (1 / price).toFixed(2);
}

function sortName(sort: string, tr: (k: string) => string): string {
  return (
    sort === "volume"
      ? tr("market.sortVolume")
      : sort === "ending"
        ? tr("market.sortEnding")
        : sort === "new"
          ? tr("market.sortNewest")
          : tr("market.sortTrending")
  ).toUpperCase();
}

/**
 * Evenly downsample a series to at most `max` samples (keeps first + last).
 */
function downsample(values: number[], max: number): number[] {
  if (values.length <= max) return values;
  const out: number[] = [];
  const step = (values.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(values[Math.round(i * step)]);
  return out;
}

/** Tiny card sparkline (60×18 viewBox) from a YES-price series (0..1). */
function buildSpark(
  raw: number[],
  fallback: number,
): { path: string; color: string } {
  let values = raw.length ? downsample(raw, 16) : [fallback, fallback];
  if (values.length === 1) values = [values[0], values[0]];
  const w = 60;
  const h = 18;
  const pad = 2;
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = (i / (n - 1)) * w;
    const y = pad + (1 - Math.max(0, Math.min(1, v))) * (h - pad * 2);
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  const up = values[n - 1] >= values[0];
  return {
    path: "M" + pts.join(" L"),
    color: up ? "#10B981" : "#F43F5E",
  };
}

/** Featured hero chart (600×120 viewBox) from a YES-price series (0..1). */
function buildFeaturedChart(
  raw: number[],
  fallback: number,
): {
  line: string;
  area: string;
  lastX: number;
  lastY: number;
  color: string;
  up: boolean;
  changePct: number | null;
} {
  let values = raw.length ? downsample(raw, 32) : [fallback, fallback];
  if (values.length === 1) values = [values[0], values[0]];
  const w = 600;
  const top = 10;
  const bottom = 110;
  const n = values.length;
  const coords = values.map((v, i) => {
    const x = (i / (n - 1)) * w;
    const y = top + (1 - Math.max(0, Math.min(1, v))) * (bottom - top);
    return [x, y] as const;
  });
  const line =
    "M" + coords.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L");
  const [lastX, lastY] = coords[coords.length - 1];
  const area = `${line} L${w} 120 L0 120 Z`;
  const up = values[n - 1] >= values[0];
  const changePct =
    raw.length >= 2
      ? Math.round((values[n - 1] - values[0]) * 100)
      : null;
  return {
    line,
    area,
    lastX,
    lastY,
    color: up ? "#10B981" : "#F43F5E",
    up,
    changePct,
  };
}

function ClockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
