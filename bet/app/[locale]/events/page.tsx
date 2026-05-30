import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import "../markets/markets-v2.css";
import { ThemeSwitch } from "../wallet/wallet-client";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { priceYes } from "@/lib/amm";
import { hubHomeUrl } from "@/lib/hub";
import { fmtCoins } from "@/lib/utils";
import { groupDisplayPrices } from "@/lib/market-group";
import {
  DEFAULT_LOCALE,
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  return buildLocalizedMetadata({
    locale,
    path: "/events",
    title: t("meta.eventsTitle", locale),
    description: t("meta.eventsDescription", locale),
  });
}

/**
 * Events index — Markets v2 design system (shared topbar / status strip /
 * page-head / card grid), wired to the same grouped-market query as before.
 * Each grouped market ("event") collapses into one card showing its leader
 * candidate + aggregate volume. Read-only; trading happens on child markets'
 * detail pages reached from an event page. Server component; the only client
 * island is the shared ThemeSwitch.
 */
export default async function EventsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);
  const lp = (h: string) => localizedPath(h, locale);

  const u = await getAuthedUser();

  const [groups, wallet, me] = await Promise.all([
    db.marketGroup.findMany({
      include: { markets: { include: marketTranslationInclude(locale) } },
      orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
      take: 60,
    }),
    u
      ? db.wallet.findUnique({ where: { userId: u.id }, select: { balance: true } })
      : Promise.resolve(null),
    u
      ? db.user.findUnique({ where: { id: u.id }, select: { username: true } })
      : Promise.resolve(null),
  ]);

  const cards = groups.map((g) => {
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

  const totalEvents = cards.length;
  const totalCandidates = cards.reduce((s, c) => s + c.childCount, 0);
  const totalVolume = cards.reduce((s, c) => s + c.volumeCoins, 0);

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
            <Link href={lp("/markets")}>{tr("nav.markets")}</Link>
            <Link className="active" href={lp("/events")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              {tr("nav.events")}
              {totalEvents > 0 && <span className="badge">{totalEvents}</span>}
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
                <Link className="avatar" href={lp("/profile")}>{initial}</Link>
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

      {/* ── STATUS STRIP ── */}
      <div className="status-strip">
        <div className="status-inner">
          <span className="live">
            {tr("group.eventCount", {
              count: totalEvents,
              s: totalEvents === 1 ? "" : "s",
            })}
          </span>
          <span className="sep">·</span>
          <span>{tr("market.openInterest", { coins: fmtCoins(totalVolume) })}</span>
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
              <span className="here">{tr("group.heading")}</span>
            </div>
            <h1 className="page-title">
              {tr("group.titleLead")} <em>{tr("group.titleEm")}</em>
            </h1>
            <p className="page-sub">{tr("group.subtitle")}</p>
          </div>
          <div className="page-stats">
            <div className="pstat">
              <div className="v">{totalEvents}</div>
              <div className="l">{tr("group.statEvents")}</div>
            </div>
            <div className="pstat">
              <div className="v cy">{totalCandidates}</div>
              <div className="l">{tr("group.statCandidates")}</div>
            </div>
            <div className="pstat">
              <div className="v" style={{ color: "var(--emerald-300)" }}>
                {fmtCoins(totalVolume)}
              </div>
              <div className="l">{tr("market.statVolume")}</div>
            </div>
          </div>
        </div>

        {cards.length === 0 ? (
          <div className="empty">{tr("group.empty")}</div>
        ) : (
          <>
            <div className="section-head">
              <div className="section-h">
                {tr("group.heading")}
                <span className="n">
                  {tr("group.eventCount", {
                    count: totalEvents,
                    s: totalEvents === 1 ? "" : "s",
                  })}
                </span>
              </div>
            </div>

            <div className="grid">
              {cards.map((g) => (
                <Link className="market" key={g.id} href={lp(`/events/${g.slug}`)}>
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
                        {tr("market.vol")} <strong>{fmtCoins(g.volumeCoins)}</strong>
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
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
