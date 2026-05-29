import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import "./watchlist-v2.css";
import { ThemeSwitch } from "../wallet/wallet-client";
import { WatchStar, WatchAdd } from "./watchlist-client";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { priceYes } from "@/lib/amm";
import { hubHomeUrl } from "@/lib/hub";
import { fmtCoins, fmtPrice } from "@/lib/utils";
import {
  DEFAULT_LOCALE,
  buildAuthRedirect,
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
const MOVE_THRESHOLD = 5; // percentage points (24h) to count as a "mover"
const ENDING_SOON_DAYS = 7;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  return buildLocalizedMetadata({
    locale,
    path: "/watchlist",
    title: t("meta.watchlistTitle", locale),
    description: t("meta.watchlistDescription", locale),
    noindex: true,
  });
}

/**
 * Watchlist — Watchlist v2 design (E:\kalki.bet-5\Watchlist.html), wired
 * to the real backend. Presentation changed wholesale; the data is real:
 * the user's watched markets marked off live AMM prices with 24h/7d moves
 * + sparklines from PricePoint history, query-param search/tab/category
 * filters, top movers, ending-soon, and suggested (top-trending, not yet
 * watched) markets. Add/remove use the existing /api/watchlist endpoint
 * via small client islands. No API/DB shapes touched. Styles under `.wl`.
 */
export default async function WatchlistPage({
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
  const u = await getAuthedUser();
  if (!u) {
    redirect(buildAuthRedirect("/watchlist", sp, locale));
  }

  const pick = (v: string | string[] | undefined): string =>
    Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
  const q = pick(sp.q).trim();
  const cat = (pick(sp.cat) || "ALL").toUpperCase();
  const tabRaw = (pick(sp.tab) || "all").toLowerCase();
  const tab = (["all", "movers", "ending"] as const).includes(tabRaw as never)
    ? (tabRaw as "all" | "movers" | "ending")
    : "all";

  const categories = [
    { value: "ALL" as const, label: tr("market.categoryAll") },
    ...listCategories(locale),
  ];
  const validCat = categories.find((c) => c.value === cat)?.value ?? "ALL";

  const now = Date.now();

  const [me, wallet, watch] = await Promise.all([
    db.user.findUnique({ where: { id: u.id }, select: { username: true } }),
    db.wallet.findUnique({ where: { userId: u.id }, select: { balance: true } }),
    db.watchlist.findMany({
      where: { userId: u.id },
      orderBy: { createdAt: "desc" },
      include: { market: { include: marketTranslationInclude(locale) } },
    }),
  ]);

  const watchedIds = watch.map((w) => w.marketId);

  const [priceRows, suggestionsRaw] = await Promise.all([
    watchedIds.length
      ? db.pricePoint.findMany({
          where: { marketId: { in: watchedIds }, recordedAt: { gte: new Date(now - 8 * DAY_MS) } },
          select: { marketId: true, yesPrice: true, recordedAt: true },
          orderBy: { recordedAt: "asc" },
          take: 6000,
        })
      : Promise.resolve([]),
    db.market.findMany({
      where: {
        status: "OPEN",
        ...(watchedIds.length > 0 ? { id: { notIn: watchedIds } } : {}),
      },
      orderBy: { trendingScore: "desc" },
      take: 5,
      include: marketTranslationInclude(locale),
    }),
  ]);

  const seriesByMarket = new Map<string, { t: number; yes: number }[]>();
  for (const r of priceRows) {
    const arr = seriesByMarket.get(r.marketId);
    const pt = { t: new Date(r.recordedAt).getTime(), yes: r.yesPrice };
    if (arr) arr.push(pt);
    else seriesByMarket.set(r.marketId, [pt]);
  }

  // Enrich every watched market with live price, 24h move and a 7d series.
  const items = watch.map((w) => {
    const m = w.market;
    const yes = priceYes({ yesShares: m.yesShares, noShares: m.noShares });
    const rows = seriesByMarket.get(m.id) ?? [];
    // YES price ~24h ago (last sample at/under the cutoff, else earliest).
    let yes24 = rows.length ? rows[0].yes : yes;
    for (const row of rows) {
      if (row.t <= now - DAY_MS) yes24 = row.yes;
      else break;
    }
    const deltaPp = Math.round((yes - yes24) * 1000) / 10; // pp, 1 decimal
    const resolved = m.status === "RESOLVED" || m.status === "CANCELLED";
    const daysLeft = Math.max(0, Math.ceil((new Date(m.endsAt).getTime() - now) / DAY_MS));
    const content = resolveMarketContent(m, locale);
    const spark = buildSpark(rows.map((r) => r.yes), yes);
    return {
      id: w.id,
      market: m,
      title: content.title,
      yes,
      deltaPp,
      resolved,
      daysLeft,
      liq: Math.round(m.yesShares + m.noShares),
      spark,
    };
  });

  // ── Stats (all real) ──
  const total = items.length;
  const avg24 = total
    ? Math.round((items.reduce((s, it) => s + it.deltaPp, 0) / total) * 10) / 10
    : 0;
  const liveCount = items.filter((it) => !it.resolved).length;
  const endingSoonCount = items.filter((it) => !it.resolved && it.daysLeft <= ENDING_SOON_DAYS).length;
  const movers = items
    .filter((it) => Math.abs(it.deltaPp) >= MOVE_THRESHOLD)
    .sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp));

  // ── Category chip counts (from full list) ──
  const catCount = new Map<string, number>();
  for (const it of items) catCount.set(it.market.category, (catCount.get(it.market.category) ?? 0) + 1);

  // ── Apply filters → displayed rows ──
  let rows = items;
  if (validCat !== "ALL") rows = rows.filter((it) => it.market.category === validCat);
  if (q) {
    const ql = q.toLowerCase();
    rows = rows.filter((it) => it.title.toLowerCase().includes(ql));
  }
  if (tab === "movers") {
    rows = rows
      .filter((it) => Math.abs(it.deltaPp) >= MOVE_THRESHOLD)
      .sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp));
  } else if (tab === "ending") {
    rows = rows.filter((it) => !it.resolved).sort((a, b) => a.daysLeft - b.daysLeft);
  }
  const shown = rows.slice(0, 20);

  // ── Sidebar: top movers (watched) + ending soon (watched) ──
  const topMovers = movers.slice(0, 5);
  const endingSoon = items
    .filter((it) => !it.resolved)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 5);

  const suggestions = suggestionsRaw.map((m) => ({
    market: m,
    title: resolveMarketContent(m, locale).title,
    yes: priceYes({ yesShares: m.yesShares, noShares: m.noShares }),
  }));

  const username = me?.username ?? "user";
  const initial = username.slice(0, 1).toUpperCase();
  const balance = wallet?.balance ?? 0;

  const buildQs = (over: Partial<{ q: string; tab: string; cat: string }>) => {
    const mm = { q, tab, cat: validCat, ...over };
    const parts: string[] = [];
    if (mm.q) parts.push(`q=${encodeURIComponent(mm.q)}`);
    if (mm.tab && mm.tab !== "all") parts.push(`tab=${mm.tab}`);
    if (mm.cat && mm.cat !== "ALL") parts.push(`cat=${mm.cat}`);
    return parts.length ? `?${parts.join("&")}` : "";
  };

  return (
    <div className="wl">
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
            <Link href={lp("/markets")}>{tr("nav.markets")}</Link>
            <Link href={lp("/events")}>{tr("nav.events")}</Link>
            <Link href={lp("/portfolio")}>{tr("nav.portfolio")}</Link>
            <Link className="active" href={lp("/watchlist")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
              </svg>
              {tr("nav.watchlist")}
            </Link>
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
          <span className="live">{tr("watchlist.watchingCount", { count: total })}</span>
          <span className="sep">·</span>
          <span>{tr("watchlist.moversStrip", { count: movers.length })}</span>
          {endingSoonCount > 0 && (
            <>
              <span className="sep">·</span>
              <span style={{ color: "var(--amber-300)" }}>
                ⚠ {tr("watchlist.endingStrip", { count: endingSoonCount })}
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── PAGE ── */}
      <main className="page">
        <div className="page-head">
          <div>
            <div className="crumbs">
              <span>{tr("market.crumbTrade")}</span>
              <span className="sep">/</span>
              <span className="here">{tr("watchlist.heading")}</span>
            </div>
            <h1 className="page-title">{tr("watchlist.titleLead")} <em>{tr("watchlist.titleEm")}</em></h1>
            <p className="page-sub">{tr("watchlist.subtitle")}</p>
          </div>
          <div className="page-stats">
            <div className="pstat"><div className="v cy">{total}</div><div className="l">{tr("watchlist.statMarkets")}</div></div>
            <div className="pstat"><div className={`v ${avg24 >= 0 ? "pos" : "neg"}`}>{avg24 >= 0 ? "+" : "−"}{Math.abs(avg24)}%</div><div className="l">{tr("watchlist.statAvgMove")}</div></div>
            <div className="pstat"><div className="v">{liveCount}</div><div className="l">{tr("watchlist.statLive")}</div></div>
            <div className="pstat"><div className="v" style={{ color: "var(--amber-300)" }}>{endingSoonCount}</div><div className="l">{tr("watchlist.statEndingSoon")}</div></div>
          </div>
        </div>

        <div className="layout">
          {/* ═══ MAIN ═══ */}
          <div className="col-main">
            {/* ALERT HIGHLIGHT */}
            <section className="alerts">
              <div className="icon-wrap">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L3 14h7l-1 8 10-12h-7z" />
                </svg>
              </div>
              <div className="copy">
                {movers.length > 0 ? (
                  <>
                    <h3><span className="em">{tr("watchlist.moversHeadline", { count: movers.length })}</span></h3>
                    <p>
                      {topMovers.slice(0, 3).map((it, i) => (
                        <span key={it.id}>
                          {i > 0 ? ", " : ""}
                          {shortTitle(it.title)} ({it.deltaPp >= 0 ? "+" : "−"}{Math.abs(it.deltaPp)}%)
                        </span>
                      ))}
                    </p>
                  </>
                ) : (
                  <>
                    <h3><span className="em">{tr("watchlist.allQuiet")}</span></h3>
                    <p>{tr("watchlist.allQuietBody")}</p>
                  </>
                )}
              </div>
              <div className="right">
                {movers.length > 0 && (
                  <Link className="btn primary" href={lp(`/watchlist${buildQs({ tab: "movers", cat: "ALL", q: "" })}`)}>
                    {tr("watchlist.seeMovers")}
                  </Link>
                )}
                <Link className="btn ghost" href={lp("/markets")}>{tr("watchlist.browseMarkets")}</Link>
              </div>
            </section>

            {/* FILTERS */}
            <div className="filterbar">
              <form className="search" method="get" action={lp("/watchlist")}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input name="q" defaultValue={q} placeholder={tr("watchlist.searchPlaceholder")} />
                {tab !== "all" && <input type="hidden" name="tab" value={tab} />}
                {validCat !== "ALL" && <input type="hidden" name="cat" value={validCat} />}
                <span className="kbd">↵</span>
              </form>
              <div className="tabs">
                {(["all", "movers", "ending"] as const).map((x) => (
                  <Link key={x} className={tab === x ? "on" : ""} href={lp(`/watchlist${buildQs({ tab: x })}`)}>
                    {x === "all" ? tr("watchlist.tabAll") : x === "movers" ? tr("watchlist.tabMovers") : tr("watchlist.tabEnding")}
                  </Link>
                ))}
              </div>
              <div className="filter-divider" />
              <div className="chips">
                {categories.map((c) => {
                  const n = c.value === "ALL" ? items.length : catCount.get(c.value) ?? 0;
                  return (
                    <Link key={c.value} className={`chip ${c.value === validCat ? "on" : ""}`} href={lp(`/watchlist${buildQs({ cat: c.value })}`)}>
                      {c.label} <span className="n">{n}</span>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* WATCH TABLE */}
            <section className="card watch-card">
              {items.length === 0 ? (
                <div className="wtr-empty">
                  {tr("watchlist.emptyLead")}{" "}
                  <Link href={lp("/markets")}>{tr("watchlist.emptyCta")}</Link>
                </div>
              ) : shown.length === 0 ? (
                <div className="wtr-empty">{tr("watchlist.noMatches")}</div>
              ) : (
                <>
                  <div className="wtr-head">
                    <div />
                    <div>{tr("watchlist.colMarket")}</div>
                    <div className="right">{tr("market.yes")}</div>
                    <div className="right">{tr("market.no")}</div>
                    <div className="right">{tr("market.volume")}</div>
                    <div>{tr("watchlist.col7d")}</div>
                    <div>{tr("market.ends")}</div>
                    <div />
                  </div>
                  {shown.map((it) => (
                    <div className="wtr" key={it.id}>
                      <WatchStar marketId={it.market.id} />
                      <div className="wtr-q">
                        <Link className="label" href={lp(`/markets/${it.market.slug}`)}>{it.title}</Link>
                        <div className="sub">
                          <span className={`cat ${catClass(it.market.category)}`}>{formatCategory(it.market.category, locale)}</span>
                          <span>{tr("market.vol")} {fmtCoins(it.market.volumeCoins)}</span>
                        </div>
                      </div>
                      <div className="yn-cell y hide-sm">
                        <span className="v">{fmtPrice(it.yes)}</span>
                        <span className={`d ${it.deltaPp >= 0 ? "pos" : "neg"}`}>{it.deltaPp >= 0 ? "▲" : "▼"} {it.deltaPp >= 0 ? "+" : "−"}{Math.abs(it.deltaPp)}%</span>
                      </div>
                      <div className="yn-cell n hide-sm">
                        <span className="v">{fmtPrice(1 - it.yes)}</span>
                        <span className={`d ${it.deltaPp <= 0 ? "pos" : "neg"}`}>{it.deltaPp <= 0 ? "▲" : "▼"} {it.deltaPp <= 0 ? "+" : "−"}{Math.abs(it.deltaPp)}%</span>
                      </div>
                      <div className="vol hide-sm"><strong>{fmtCoins(it.market.volumeCoins)}</strong><span className="sub">{tr("market.liq")} {fmtCoins(it.liq)}</span></div>
                      <svg className="spark hide-sm" viewBox="0 0 80 26" preserveAspectRatio="none">
                        <path d={it.spark.path} stroke={it.spark.color} strokeWidth="1.6" fill="none" />
                      </svg>
                      <div className={`end hide-sm ${!it.resolved && it.daysLeft <= ENDING_SOON_DAYS ? "urgent" : ""}`}>
                        <span className="relative">{it.resolved ? tr("market.resolved") : tr("watchlist.daysLeft", { n: it.daysLeft })}</span>
                        {endsLabel(it.market.endsAt, locale)}
                      </div>
                      <Link className="trade-btn" href={lp(`/markets/${it.market.slug}`)}>{tr("watchlist.trade")} →</Link>
                    </div>
                  ))}
                  <div className="wtr-foot">
                    <span>{tr("watchlist.showingCount", { shown: shown.length, total: items.length })}</span>
                    <Link className="small-link" href={lp("/markets")}>{tr("watchlist.browseMarkets")} →</Link>
                  </div>
                </>
              )}
            </section>
          </div>

          {/* ═══ SIDE ═══ */}
          <aside className="col-side">
            {/* TOP MOVERS */}
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">{tr("watchlist.eyebrowHot")}</div>
                  <div className="card-title">{tr("watchlist.topMovers")}</div>
                </div>
                <Link className="small-link" href={lp("/markets?sort=trending")}>{tr("watchlist.seeAll")} →</Link>
              </div>
              <div>
                {topMovers.length === 0 ? (
                  <div className="side-empty">{tr("watchlist.noMovers")}</div>
                ) : (
                  topMovers.map((it, i) => (
                    <Link className="mover" key={it.id} href={lp(`/markets/${it.market.slug}`)}>
                      <span className="rank">{i + 1}</span>
                      <div className="meta">
                        <div className="nm">{it.title}</div>
                        <div className="sub">{formatCategory(it.market.category, locale)} · {tr("market.yes")} {fmtPrice(it.yes)}</div>
                      </div>
                      <span className={`delta ${it.deltaPp > 0 ? "pos" : it.deltaPp < 0 ? "neg" : "flat"}`}>
                        {it.deltaPp >= 0 ? "+" : "−"}{Math.abs(it.deltaPp)}%
                      </span>
                    </Link>
                  ))
                )}
              </div>
            </div>

            {/* ENDING SOON */}
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">{tr("watchlist.eyebrowEnding")}</div>
                  <div className="card-title">{tr("watchlist.endingSoonTitle")}</div>
                </div>
              </div>
              <div>
                {endingSoon.length === 0 ? (
                  <div className="side-empty">{tr("watchlist.noEnding")}</div>
                ) : (
                  endingSoon.map((it) => (
                    <Link className="mover" key={it.id} href={lp(`/markets/${it.market.slug}`)}>
                      <div className="meta">
                        <div className="nm">{it.title}</div>
                        <div className="sub">{formatCategory(it.market.category, locale)} · {endsLabel(it.market.endsAt, locale)}</div>
                      </div>
                      <span className={`delta ${it.daysLeft <= ENDING_SOON_DAYS ? "neg" : "flat"}`} style={it.daysLeft <= ENDING_SOON_DAYS ? { background: "rgba(251,191,36,0.12)", color: "var(--amber-300)" } : undefined}>
                        {tr("watchlist.daysLeft", { n: it.daysLeft })}
                      </span>
                    </Link>
                  ))
                )}
              </div>
            </div>

            {/* SUGGESTIONS */}
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">{tr("watchlist.eyebrowForYou")}</div>
                  <div className="card-title">{tr("watchlist.suggested")}</div>
                </div>
              </div>
              <div>
                {suggestions.length === 0 ? (
                  <div className="side-empty">{tr("watchlist.noSuggestions")}</div>
                ) : (
                  suggestions.map((s) => (
                    <div className="sug" key={s.market.id}>
                      <div className="sug-top">
                        <Link className="nm" href={lp(`/markets/${s.market.slug}`)}>{s.title}</Link>
                        <WatchAdd marketId={s.market.id} />
                      </div>
                      <div className="sub">
                        <span className={`cat ${catClass(s.market.category)}`}>{formatCategory(s.market.category, locale)}</span>
                        <span>{tr("market.yes")} {fmtPrice(s.yes)} · {tr("market.vol")} {fmtCoins(s.market.volumeCoins)}</span>
                      </div>
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
          <span>{tr("watchlist.footerBrand")}</span>
          <span>{tr("market.footerCompliance")}</span>
          <span>{tr("wallet.needHelp")} <Link href={lp("/profile")}>{tr("profile.heading")}</Link></span>
        </div>
      </footer>
    </div>
  );
}

/* ── helpers ───────────────────────────────────────────────── */

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

function endsLabel(endsAt: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "2-digit" }).format(new Date(endsAt));
}

function shortTitle(title: string): string {
  return title.length > 28 ? `${title.slice(0, 27)}…` : title;
}

function downsample(values: number[], max: number): number[] {
  if (values.length <= max) return values;
  const out: number[] = [];
  const step = (values.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(values[Math.round(i * step)]);
  return out;
}

/** 7D sparkline (80×26 viewBox) from a YES-price series (0..1). */
function buildSpark(raw: number[], fallback: number): { path: string; color: string } {
  let values = raw.length ? downsample(raw, 10) : [fallback, fallback];
  if (values.length === 1) values = [values[0], values[0]];
  const w = 80;
  const h = 26;
  const pad = 3;
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = (i / (n - 1)) * w;
    const y = pad + (1 - Math.max(0, Math.min(1, v))) * (h - pad * 2);
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  const up = values[n - 1] >= values[0];
  return { path: "M" + pts.join(" L"), color: up ? "#10B981" : "#F43F5E" };
}
