import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { WatchToggle } from "@/components/WatchToggle";
import { getSessionToken } from "@/lib/session";
import {
  backend,
  BackendApiError,
  type Auction,
  type WatchlistListResponse,
} from "@/lib/backend";
import { relativeTime } from "@/lib/utils";
import {
  DEFAULT_LOCALE,
  buildLocalizedMetadata,
  isLocale,
  localizedPath,
  t,
  type Locale,
} from "@/lib/i18n";
import { BidPanel } from "./BidPanel";
import { ImageCarousel } from "./ImageCarousel";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale: raw, id } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  return buildLocalizedMetadata({
    locale,
    path: `/auctions/${id}`,
    title: t("meta.auctionDetailTitle", locale),
    description: t("meta.auctionDetailDescription", locale),
  });
}

export default async function AuctionDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: raw, id } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);
  const lp = (path: string) => localizedPath(path, locale);

  let auction: Auction;
  try {
    auction = await backend.publicGet<Auction>(`/auctions/${id}`);
  } catch (err) {
    if (err instanceof BackendApiError && err.status === 404) notFound();
    throw err;
  }

  // We need to know if the visitor is signed in (to enable the bid
  // form). We do NOT need their identity here — `BidPanel` calls
  // `/api/bid/:id` server-side, which reads the cookie directly.
  const token = await getSessionToken();
  const signedIn = !!token;

  // Watchlist state: only relevant for signed-in users AND only when
  // the `watchlist.enabled` flag is ON server-side. We piggy-back on
  // `/me/watchlist` (one call, gracefully fails if the flag is off)
  // rather than adding a per-auction `isWatching` endpoint — the
  // shape is forward-compatible with a "you're watching N items"
  // summary on the detail page in the future.
  let initialWatching = false;
  let watchlistEnabled = false;
  if (signedIn && token) {
    try {
      const list = await backend.authed(token).get<WatchlistListResponse>(
        "/me/watchlist",
      );
      watchlistEnabled = true;
      initialWatching = list.items.some((i) => i.auction.id === auction.id);
    } catch (err) {
      // 403 = feature flag is off → hide the toggle. Other errors
      // silently hide it too; the user doesn't lose any function.
      watchlistEnabled = false;
    }
  }

  const coinsPerBidLabel =
    auction.coinsPerBid === 1
      ? tr("auction.coinsPerBidValue", { n: auction.coinsPerBid })
      : tr("auction.coinsPerBidValuePlural", { n: auction.coinsPerBid });

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-5xl px-4 py-6">
        <Link
          href={lp("/auctions")}
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
        >
          {tr("auction.backAll")}
        </Link>

        <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <ImageCarousel title={auction.title} images={auction.imageUrls} />

          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <StatusBadge status={auction.status} tr={tr} />
                <span className="text-[11px] text-slate-500">
                  <TimeHint auction={auction} tr={tr} />
                </span>
              </div>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h1 className="text-2xl font-black leading-tight text-slate-100">
                  {auction.title}
                </h1>
                {watchlistEnabled && (
                  <WatchToggle
                    auctionId={auction.id}
                    initialWatching={initialWatching}
                  />
                )}
              </div>
            </div>

            <Card className="space-y-2">
              <Stat
                label={tr("auction.retailPrice")}
                value={`₹${Number(auction.retailPrice).toLocaleString("en-IN")}`}
              />
              <Stat
                label={tr("auction.coinsPerBid")}
                value={coinsPerBidLabel}
              />
              {auction.status === "ENDED" && auction.winner && (
                <Stat
                  label={tr("auction.winner")}
                  value={
                    <span className="text-emerald-300">
                      @{auction.winner.username}
                      {auction.winnerAmount && (
                        <> · ₹{Number(auction.winnerAmount).toFixed(2)}</>
                      )}
                    </span>
                  }
                />
              )}
            </Card>

            <Card>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                {tr("auction.placeBidHeading")}
              </h2>
              <BidPanel
                auctionId={auction.id}
                coinsPerBid={auction.coinsPerBid}
                status={auction.status}
                signedIn={signedIn}
              />
            </Card>

            <Card>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                {tr("auction.howItWorksHeading")}
              </h2>
              <ol className="list-decimal space-y-1 pl-4 text-sm text-slate-300">
                <li>
                  {tr("auction.howItWorks1", {
                    coins: auction.coinsPerBid,
                    s: auction.coinsPerBid === 1 ? "" : "s",
                  })}
                </li>
                <li>{tr("auction.howItWorks2")}</li>
                <li>{tr("auction.howItWorks3")}</li>
              </ol>
            </Card>
          </div>
        </div>

        {auction.description?.trim() && (
          <section className="mt-10 border-t border-[var(--color-divider)] pt-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
              {tr("auction.aboutThisItem")}
            </h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-300">
              {auction.description}
            </p>
          </section>
        )}
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-800 py-2 last:border-b-0 last:pb-0">
      <div className="text-xs uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="text-sm font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function StatusBadge({
  status,
  tr,
}: {
  status: Auction["status"];
  tr: (k: string, vars?: Record<string, string | number>) => string;
}) {
  if (status === "LIVE") return <Badge tone="live">{tr("auction.statusLive")}</Badge>;
  if (status === "UPCOMING")
    return <Badge tone="upcoming">{tr("auction.statusUpcoming")}</Badge>;
  return <Badge tone="ended">{tr("auction.statusEnded")}</Badge>;
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
