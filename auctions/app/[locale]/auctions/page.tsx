import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { backend, type Auction } from "@/lib/backend";
import { cn, relativeTime } from "@/lib/utils";
import {
  DEFAULT_LOCALE,
  buildLocalizedMetadata,
  isLocale,
  localizedPath,
  t,
  type Locale,
} from "@/lib/i18n";

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
 * carried in `?tab=` so the URL is shareable and a refresh stays on
 * the same view. The closed-tab tiles surface the winner inline — same
 * design pattern as the Android app's HomeScreen.
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

  const tabs: { value: Tab; label: string; count: (a: Auction[]) => number }[] = [
    { value: "LIVE", label: tr("auction.tabLive"), count: (a) => a.filter((x) => x.status === "LIVE").length },
    { value: "UPCOMING", label: tr("auction.tabUpcoming"), count: (a) => a.filter((x) => x.status === "UPCOMING").length },
    { value: "ENDED", label: tr("auction.tabClosed"), count: (a) => a.filter((x) => x.status === "ENDED").length },
  ];

  const sp = await searchParams;
  const rawTab = (sp.tab ?? "LIVE").toUpperCase() as Tab;
  const tab: Tab = tabs.some((t) => t.value === rawTab) ? rawTab : "LIVE";

  let all: Auction[] = [];
  let fetchError: string | null = null;
  try {
    all = await backend.publicGet<Auction[]>("/auctions");
  } catch (err) {
    fetchError = err instanceof Error ? err.message : tr("auction.fetchError", { error: "" });
  }

  const filtered = all.filter((a) => a.status === tab);
  // For the Closed tab, surface most-recently-closed first.
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
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-4">
          <h1 className="text-2xl font-black">{tr("auction.heading")}</h1>
          <p className="text-sm text-slate-400">
            {tr("auction.subtext")}
          </p>
        </div>

        {/* Tab bar — mirrors the Android HomeScreen's filter chip row.
            The active tab gets a brand-coloured underline + bold weight;
            inactive tabs stay quiet. Counts make the catalog scannable
            at a glance ("Are there even Upcoming ones today?"). */}
        <nav className="mb-5 flex items-center gap-1 border-b border-[var(--color-divider)]">
          {tabs.map((tabDef) => {
            const active = tabDef.value === tab;
            const count = tabDef.count(all);
            return (
              <Link
                key={tabDef.value}
                href={`${lp("/auctions")}?tab=${tabDef.value}`}
                className={cn(
                  "relative px-3 py-2 text-sm font-semibold transition",
                  active
                    ? "text-cyan-300"
                    : "text-slate-400 hover:text-slate-200",
                )}
              >
                {tabDef.label}
                <span
                  className={cn(
                    "ml-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full border px-1.5 text-[10px] font-bold tabular-nums",
                    active
                      ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                      : "border-slate-700 bg-slate-900/60 text-slate-500",
                  )}
                >
                  {count}
                </span>
                {active && (
                  <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-cyan-400" />
                )}
              </Link>
            );
          })}
        </nav>

        {fetchError && (
          <Card className="mb-6 border-rose-500/30 bg-rose-500/10 text-sm text-rose-200">
            {tr("auction.fetchError", { error: fetchError })}
          </Card>
        )}

        {filtered.length === 0 ? (
          <Card className="text-sm text-slate-500">{empty[tab]}</Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((a) => (
              <AuctionTile key={a.id} a={a} locale={locale} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function AuctionTile({ a, locale }: { a: Auction; locale: Locale }) {
  const hero = a.imageUrls[0];
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);
  return (
    <Link
      href={`${localizedPath("/auctions", locale)}/${a.id}`}
      className="block transition hover:-translate-y-0.5"
    >
      <Card className="overflow-hidden p-0 hover:border-cyan-500/40">
        {hero ? (
          <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-950">
            <Image
              src={hero}
              alt={a.title}
              fill
              sizes="(min-width: 1024px) 24vw, (min-width: 640px) 50vw, 100vw"
              className="object-cover"
              unoptimized
            />
            <div className="absolute left-2 top-2">
              <StatusBadge status={a.status} tr={tr} />
            </div>
          </div>
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center bg-slate-900 text-slate-700">
            🛒
          </div>
        )}
        <div className="p-3">
          <h3 className="line-clamp-2 text-sm font-semibold text-slate-100">
            {a.title}
          </h3>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
            <span>
              {tr("auction.retailPrice")} ₹
              {Number(a.retailPrice).toLocaleString("en-IN")}
            </span>
            <span>
              <TimeHint auction={a} tr={tr} />
            </span>
          </div>
          {/* Closed-tab winners get their own row so they stand out from
              the generic price/time line above. */}
          {a.status === "ENDED" && (
            <WinnerLine auction={a} tr={tr} />
          )}
        </div>
      </Card>
    </Link>
  );
}

function WinnerLine({
  auction,
  tr,
}: {
  auction: Auction;
  tr: (k: string, vars?: Record<string, string | number>) => string;
}) {
  if (!auction.winner) {
    return (
      <div className="mt-2 text-[11px] text-slate-500">
        {tr("auction.winnerNoneDeclared")}
      </div>
    );
  }
  return (
    <div className="mt-2 flex items-center gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2 py-1 text-[11px] text-emerald-200">
      <span>🏆</span>
      <span className="truncate">
        <span className="font-semibold">@{auction.winner.username}</span>{" "}
        {auction.winnerAmount && (
          <>
            {tr("auction.winnerWonAt")} ₹
            {Number(auction.winnerAmount).toFixed(2)}
          </>
        )}
      </span>
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
