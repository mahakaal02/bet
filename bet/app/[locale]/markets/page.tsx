import type { Metadata } from "next";
import type { CSSProperties } from "react";
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
import { groupDisplayPrices } from "@/lib/market-group";

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
    // Grouped children collapse into their event's card (queried separately
    // below), so they never appear as standalone cards or in the counts. With
    // zero groups every market has groupId = null → identical to before.
    groupId: null,
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
    wallet,
    me,
    openCount,
    resolvedCount,
    newTodayCount,
    volAgg,
    catCounts,
    filteredCount,
    groups,
  ] = await Promise.all([
    db.market.findMany({
      where,
      include: marketTranslationInclude(locale),
      orderBy,
      take: 60,
    }),
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
    // Grouped "events" honor the SAME status/category/search filters and
    // collapse to one card alongside the standalone markets. Purely additive:
    // with zero groups this is [] and the page renders exactly as before.
    db.marketGroup.findMany({
      where: {
        ...(status !== "ALL" && {
          status: status as "OPEN" | "RESOLVED" | "CLOSED" | "CANCELLED",
        }),
        ...(validCat !== "ALL" && { category: validCat as MarketCategory }),
        ...(q && {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
          ],
        }),
      },
      include: { markets: { include: marketTranslationInclude(locale) } },
      orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
      take: 30,
    }),
  ]);

  // The hero "floating tiles" surface the top 3 markets of the default
  // browse view (no search, open, all categories). They're carved out of
  // the same `markets` list, then excluded from the grid below so nothing
  // shows twice. Filtered/searched views skip the hero entirely.
  const heroMarkets = showFeatured ? markets.slice(0, 3) : [];
  const heroIdSet = new Set(heroMarkets.map((m) => m.id));
  const gridMarkets = showFeatured
    ? markets.filter((m) => !heroIdSet.has(m.id))
    : markets;
  const gridIds = gridMarkets.map((m) => m.id);

  // One bounded query for every visible card's recent price series (grid +
  // hero) — grouped + downsampled in JS so the sparklines are real, not faked.
  const sparkIds = [...gridIds, ...heroMarkets.map((m) => m.id)];
  const sparkWindow = new Date(Date.now() - 45 * DAY_MS);
  const sparkRows = sparkIds.length
    ? await db.pricePoint.findMany({
        where: { marketId: { in: sparkIds }, recordedAt: { gte: sparkWindow } },
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

  // Collapse each event to one card: rank its children by display-normalized
  // YES share (resolution-adjusted so a settled winner shows 100%) and surface
  // the leader + aggregate volume. Pure display math — never touches the AMM.
  const groupCards = groups.map((g) => {
    const exclusive = g.type === "EXCLUSIVE";
    const resolved = g.status === "RESOLVED" || g.status === "CANCELLED";
    const childPrices = g.markets.map((m) => ({
      marketId: m.id,
      yesPrice:
        m.status === "RESOLVED"
          ? m.resolvedAs === "YES"
            ? 1
            : m.resolvedAs === "NO"
              ? 0
              : priceYes({ yesShares: m.yesShares, noShares: m.noShares })
          : priceYes({ yesShares: m.yesShares, noShares: m.noShares }),
    }));
    const pctById = new Map(
      groupDisplayPrices(childPrices, exclusive).map((d) => [
        d.marketId,
        d.normalizedPct,
      ]),
    );
    const leader = [...g.markets].sort(
      (a, b) => (pctById.get(b.id) ?? 0) - (pctById.get(a.id) ?? 0),
    )[0];
    return {
      id: g.id,
      slug: g.slug,
      title: g.title,
      category: g.category,
      childCount: g.markets.length,
      volumeCoins: g.markets.reduce((s, m) => s + m.volumeCoins, 0),
      leaderTitle: leader ? resolveMarketContent(leader, locale).title : null,
      leaderPct: leader ? pctById.get(leader.id) ?? 0 : 0,
      resolvedLabel: resolved
        ? g.status === "CANCELLED"
          ? tr("market.cancelled")
          : tr("market.resolved")
        : null,
    };
  });

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
            <img className="brand-mark" src="/kalki-logo.png?v=2" alt="Kalki Exchange" width={34} height={34} />
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
            <Link href={lp("/events")}>{tr("nav.events")}</Link>
            <Link href={lp("/portfolio")}>{tr("nav.portfolio")}</Link>
            <Link href={lp("/watchlist")}>{tr("nav.watchlist")}</Link>
            <Link href={lp("/wallet")}>{tr("nav.wallet")}</Link>
          </nav>

          <div className="topbar-right">
            {u ? (
              <>
                <span className="balance-pill">
                  <span className="lbl">BAL</span> {fmtCoins(balance, locale)}
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
          <span>{tr("market.openInterest", { coins: fmtCoins(totalVol, locale) })}</span>
          <span className="sep">·</span>
          <span>{tr("market.settleFast")}</span>
        </div>
      </div>

      {/* ── PAGE ── */}
      <main className="page">
        {/* Intro copy block — shared between the two-column hero (when the
            floating tiles are shown) and the standalone head (filtered views). */}
        {(() => {
          const intro = (
            <div className="fl-intro">
              <div className="crumbs">
                <span>{tr("market.crumbTrade")}</span>
                <span className="sep">/</span>
                <span className="here">{tr("market.heading")}</span>
              </div>
              <h1 className="page-title">
                {tr("market.titleLead")} <em>{tr("market.titleEm")}</em>
              </h1>
              <p className="page-sub">{tr("market.subtitle")}</p>
              <div className="page-stats">
                <div className="pstat">
                  <div className="v">{openCount}</div>
                  <div className="l">{tr("market.statOpen")}</div>
                </div>
                <div className="pstat">
                  <div className="v cy">{fmtCoins(totalVol, locale)}</div>
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
          );

          // Filtered / searched views: no floating tiles — keep the plain head.
          if (heroMarkets.length === 0) {
            return <div className="page-head">{intro}</div>;
          }

          // Default browse view: two-column hero — intro LEFT, tiles RIGHT.
          return (
            <section className="fl-hero" aria-label={tr("market.heading")}>
              {intro}
              <div className="fl-field">
                {heroMarkets.map((m, idx) => {
                const p = priceYes({ yesShares: m.yesShares, noShares: m.noShares });
                const localized = resolveMarketContent(m, locale);
                const series = sparkByMarket.get(m.id) ?? [];
                const spark = buildFloatSpark(series, p);
                const pctYes = Math.round(p * 100);
                const liq = Math.round(m.yesShares + m.noShares);
                const pos = FLOAT_POS[idx] ?? FLOAT_POS[0];
                const gradId = `flG${idx}`;
                return (
                  <div
                    key={m.id}
                    className={`fl-wrap f${idx + 1}`}
                    style={
                      {
                        top: pos.top,
                        left: pos.left,
                        zIndex: pos.z,
                        "--s": pos.scale,
                      } as CSSProperties
                    }
                  >
                    <Link className="fl-card" href={lp(`/markets/${m.slug}`)}>
                      <div className="fl-head">
                        <span className={`fl-cat cat ${catClass(m.category)}`}>
                          {formatCategory(m.category, locale)}
                        </span>
                        <span className={`ends ${isUrgent(m.endsAt) ? "urgent" : ""}`}>
                          <ClockIcon />
                          {endsLabel(m.endsAt, locale)}
                        </span>
                      </div>
                      <div className="fl-q">{localized.title}</div>
                      <div className="fl-prob">
                        <span className="v">
                          {pctYes}
                          <i>%</i>
                        </span>
                        <span className="lab">{tr("market.probability")}</span>
                        {spark.changePct !== null && (
                          <span className={`d ${spark.up ? "up" : "down"}`}>
                            {spark.up ? "▲" : "▼"} {Math.abs(spark.changePct)}%
                          </span>
                        )}
                      </div>
                      <svg className="fl-spark" viewBox="0 0 300 56" preserveAspectRatio="none">
                        <defs>
                          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={spark.up ? "rgba(16,185,129,0.32)" : "rgba(244,63,94,0.32)"} />
                            <stop offset="100%" stopColor={spark.up ? "rgba(16,185,129,0)" : "rgba(244,63,94,0)"} />
                          </linearGradient>
                        </defs>
                        <path d={spark.area} fill={`url(#${gradId})`} />
                        <path d={spark.line} fill="none" stroke={spark.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                      </svg>
                      <div className="fl-foot">
                        <div className="kv">
                          <span className="k">{tr("market.volume")}</span>
                          <span className="val">{fmtCoins(m.volumeCoins, locale)}</span>
                        </div>
                        <div className="kv">
                          <span className="k">{tr("market.liquidity")}</span>
                          <span className="val">{fmtCoins(liq, locale)}</span>
                        </div>
                      </div>
                      <div className="fl-bet">
                        <span className="fl-yn yes">
                          <span className="t">{tr("market.yes")}</span>
                          <span className="px">{fmtPrice(p, 2, locale)}</span>
                        </span>
                        <span className="fl-yn no">
                          <span className="t">{tr("market.no")}</span>
                          <span className="px">{fmtPrice(1 - p, 2, locale)}</span>
                        </span>
                      </div>
                    </Link>
                  </div>
                  );
                })}
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
        {markets.length === 0 && groupCards.length === 0 ? (
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

            {gridMarkets.length > 0 || groupCards.length > 0 ? (
              <div className="grid">
                {groupCards.map((g) => (
                  <Link className="market" key={`g-${g.id}`} href={lp(`/events/${g.slug}`)}>
                    <div className="market-top">
                      <span className={`cat ${catClass(g.category)}`}>
                        {formatCategory(g.category, locale)}
                      </span>
                      <span className="ends">
                        {g.resolvedLabel ??
                          tr("group.candidateCount", {
                            count: g.childCount,
                            s: g.childCount === 1 ? "" : "s",
                          })}
                      </span>
                    </div>
                    <div className="q">{g.title}</div>
                    <div className="yn">
                      <span className="ynbtn y" style={{ gridColumn: "1 / -1" }}>
                        <span
                          className="l"
                          style={{
                            flex: 1,
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            letterSpacing: "0.01em",
                          }}
                        >
                          {g.leaderTitle ?? tr("group.empty")}
                        </span>
                        <span className="p">{g.leaderTitle ? `${g.leaderPct}%` : "—"}</span>
                      </span>
                    </div>
                    <div className="market-foot">
                      <div className="lhs">
                        <span>
                          {tr("market.vol")} <strong>{fmtCoins(g.volumeCoins, locale)}</strong>
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
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
                          <span className="p">{fmtPrice(p, 2, locale)}</span>
                        </span>
                        <span className="ynbtn n">
                          <span className="l">{tr("market.no")}</span>
                          <span className="p">{fmtPrice(1 - p, 2, locale)}</span>
                        </span>
                      </div>
                      <div className="market-foot">
                        <div className="lhs">
                          <span>{tr("market.vol")} <strong>{fmtCoins(m.volumeCoins, locale)}</strong></span>
                          <span>{tr("market.liq")} <strong>{fmtCoins(Math.round(m.yesShares + m.noShares), locale)}</strong></span>
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
                  shown: Math.min(filteredCount, gridMarkets.length + heroMarkets.length),
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

/**
 * Depth-layered positions for the floating hero tiles (KALKI landing
 * style). top/left are % of the stage; `scale` is baked into the bob
 * keyframe via the `--s` CSS var so the float animation doesn't clobber
 * it; `z` controls stacking so the larger/front card reads as nearest.
 */
const FLOAT_POS: { top: string; left: string; scale: number; z: number }[] = [
  { top: "2%", left: "30%", scale: 1, z: 3 },
  { top: "30%", left: "2%", scale: 0.88, z: 2 },
  { top: "52%", left: "56%", scale: 0.84, z: 1 },
];

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

/** Floating-tile sparkline (300×56 viewBox) from a YES-price series (0..1). */
function buildFloatSpark(
  raw: number[],
  fallback: number,
): {
  line: string;
  area: string;
  color: string;
  up: boolean;
  changePct: number | null;
} {
  let values = raw.length ? downsample(raw, 28) : [fallback, fallback];
  if (values.length === 1) values = [values[0], values[0]];
  const w = 300;
  const top = 6;
  const bottom = 50;
  const n = values.length;
  const coords = values.map((v, i) => {
    const x = (i / (n - 1)) * w;
    const y = top + (1 - Math.max(0, Math.min(1, v))) * (bottom - top);
    return [x, y] as const;
  });
  const line =
    "M" + coords.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L");
  const area = `${line} L${w} 56 L0 56 Z`;
  const up = values[n - 1] >= values[0];
  const changePct =
    raw.length >= 2 ? Math.round((values[n - 1] - values[0]) * 100) : null;
  return {
    line,
    area,
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
