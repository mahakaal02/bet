import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { backend, type Auction } from "@/lib/backend";
import { detectCountry, type CountryCode } from "@/lib/locale-detect";
import { loadFxRates, type FxRates } from "@/lib/fx";
import { formatMoneyFromINR, formatLocalNumber } from "@/lib/currency";
import { cn, relativeTime } from "@/lib/utils";
import { HowItWorks } from "./HowItWorks";
import {
  DEFAULT_LOCALE,
  buildLocalizedMetadata,
  isLocale,
  localizedPath,
  t,
  type Locale,
} from "@/lib/i18n";
import "./auctions-theme.css";

export const dynamic = "force-dynamic";

type Tab = "LIVE" | "UPCOMING" | "ENDED";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  return buildLocalizedMetadata({
    locale,
    path: "/auctions",
    title: t("meta.auctionsTitle", locale),
    description: t("meta.auctionsDescription", locale),
  });
}

/**
 * Auctions catalog. Three tabs: Live / Upcoming / Closed. Tab choice is
 * carried in `?tab=` so the URL is shareable. Styled with the "How It
 * Works" handoff theme (warm-humanist fintech, dark-first) — see
 * `auctions-theme.css`. All money is rendered in the viewer's local
 * currency (resolved from location) — never a hardcoded ₹.
 */
export default async function AuctionsListPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);
  const lp = (path: string) => localizedPath(path, locale);

  const tabs: { value: Tab; label: string }[] = [
    { value: "LIVE", label: tr("auction.tabLive") },
    { value: "UPCOMING", label: tr("auction.tabUpcoming") },
    { value: "ENDED", label: tr("auction.tabClosed") },
  ];

  const sp = await searchParams;
  const rawTab = (sp.tab ?? "LIVE").toUpperCase() as Tab;
  const tab: Tab = tabs.some((t) => t.value === rawTab) ? rawTab : "LIVE";

  const country = await detectCountry(
    sp as Record<string, string | string[] | undefined>,
  );
  const { rates } = await loadFxRates();

  let all: Auction[] = [];
  let fetchError: string | null = null;
  try {
    all = await backend.publicGet<Auction[]>("/auctions");
  } catch (err) {
    fetchError = err instanceof Error ? err.message : tr("auction.fetchError", { error: "" });
  }

  const countFor = (v: Tab) => all.filter((x) => x.status === v).length;
  const filtered = all.filter((a) => a.status === tab);
  if (tab === "ENDED") {
    filtered.sort((a, b) => {
      const ax = a.closedAt ? new Date(a.closedAt).getTime() : 0;
      const bx = b.closedAt ? new Date(b.closedAt).getTime() : 0;
      return bx - ax;
    });
  }

  const empty: Record<Tab, string> = {
    LIVE: tr("auction.emptyLive"),
    UPCOMING: tr("auction.emptyUpcoming"),
    ENDED: tr("auction.emptyEnded"),
  };

  return (
    <>
      <Navbar />
      <main className="kalki-hiw">
        <div className="hiw-wrap">
          <span className="hiw-eyebrow">
            <span className="pulse" />
            Lowest Unique Bid auctions
          </span>
          <h1 className="hiw-h1">
            {tr("auction.heading")}
          </h1>
          <p className="hiw-sub">{tr("auction.subtext")}</p>

          <HowItWorks browseHref={`${lp("/auctions")}?tab=LIVE`} />

          <nav className="hiw-tabs" aria-label="Auction status">
            {tabs.map((tabDef) => {
              const active = tabDef.value === tab;
              return (
                <Link
                  key={tabDef.value}
                  href={`${lp("/auctions")}?tab=${tabDef.value}`}
                  className={cn("hiw-tab", active && "active")}
                  aria-current={active ? "page" : undefined}
                >
                  {tabDef.label}
                  <span className="hiw-count">{countFor(tabDef.value)}</span>
                </Link>
              );
            })}
          </nav>

          {fetchError && (
            <div className="hiw-note error">
              {tr("auction.fetchError", { error: fetchError })}
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="hiw-note">{empty[tab]}</div>
          ) : (
            <div className="hiw-grid">
              {filtered.map((a) => (
                <AuctionTile
                  key={a.id}
                  a={a}
                  locale={locale}
                  country={country}
                  rates={rates}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}

function AuctionTile({
  a,
  locale,
  country,
  rates,
}: {
  a: Auction;
  locale: Locale;
  country: CountryCode;
  rates: FxRates["rates"];
}) {
  const hero = a.imageUrls[0];
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);
  const statusLabel =
    a.status === "LIVE"
      ? tr("auction.statusLive")
      : a.status === "UPCOMING"
        ? tr("auction.statusUpcoming")
        : tr("auction.statusEnded");

  return (
    <Link className="lot" href={`${localizedPath("/auctions", locale)}/${a.id}`}>
      <div className="ph">
        {hero ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={hero} alt={a.title} loading="lazy" />
        ) : (
          <div className="ph-fallback" aria-hidden>
            🛒
          </div>
        )}
        <span
          className={cn(
            "tag",
            a.status === "LIVE" && "live",
            a.status === "UPCOMING" && "upcoming",
          )}
        >
          {statusLabel}
        </span>
        <span className="timeleft">
          <TimeHint auction={a} tr={tr} />
        </span>
      </div>
      <div className="body">
        <h3>{a.title}</h3>
        <div className="val">
          {tr("auction.retailPrice")}{" "}
          <b>{formatMoneyFromINR(a.retailPrice, country, rates)}</b>
        </div>
        {a.status === "ENDED" && (
          <WinnerLine auction={a} tr={tr} country={country} />
        )}
      </div>
    </Link>
  );
}

function WinnerLine({
  auction,
  tr,
  country,
}: {
  auction: Auction;
  tr: (k: string, vars?: Record<string, string | number>) => string;
  country: CountryCode;
}) {
  if (!auction.winner) {
    return <div className="hiw-winner none">{tr("auction.winnerNoneDeclared")}</div>;
  }
  return (
    <div className="hiw-winner">
      <span aria-hidden>🏆</span>
      <span>
        <b>@{auction.winner.username}</b>
        {auction.winnerAmount && (
          <>
            {" "}
            {tr("auction.winnerWonAt")}{" "}
            <span className="amt">
              🪙 {formatLocalNumber(auction.winnerAmount, country, 2)}
            </span>
          </>
        )}
      </span>
    </div>
  );
}

function TimeHint({
  auction,
  tr,
}: {
  auction: Auction;
  tr: (k: string, vars?: Record<string, string | number>) => string;
}) {
  const now = Date.now();
  if (auction.status === "UPCOMING") {
    const start = auction.startsAt ? new Date(auction.startsAt).getTime() : null;
    if (!start) return <>{tr("auction.timeStartsSoon")}</>;
    return <>{tr("auction.timeStartsIn", { time: relativeTime(start - now, "in") })}</>;
  }
  if (auction.status === "LIVE") {
    const ends = new Date(auction.endsAt).getTime();
    if (ends <= now) return <>{tr("auction.timeEndingNow")}</>;
    return <>{tr("auction.timeEndsIn", { time: relativeTime(ends - now, "in") })}</>;
  }
  if (auction.closedAt) {
    return <>{tr("auction.timeEndedAt", { time: relativeTime(now - new Date(auction.closedAt).getTime(), "ago") })}</>;
  }
  return <>{tr("auction.timeEnded")}</>;
}
