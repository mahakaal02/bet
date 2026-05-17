import Image from "next/image";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { backend, type Auction } from "@/lib/backend";
import { cn, relativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Tab = "LIVE" | "UPCOMING" | "ENDED";

const TABS: { value: Tab; label: string; count: (a: Auction[]) => number }[] = [
  { value: "LIVE", label: "Live", count: (a) => a.filter((x) => x.status === "LIVE").length },
  { value: "UPCOMING", label: "Upcoming", count: (a) => a.filter((x) => x.status === "UPCOMING").length },
  { value: "ENDED", label: "Closed", count: (a) => a.filter((x) => x.status === "ENDED").length },
];

/**
 * Auctions catalog. Three tabs: Live / Upcoming / Closed. Tab choice is
 * carried in `?tab=` so the URL is shareable and a refresh stays on
 * the same view. The closed-tab tiles surface the winner inline — same
 * design pattern as the Android app's HomeScreen.
 */
export default async function AuctionsListPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const raw = (sp.tab ?? "LIVE").toUpperCase() as Tab;
  const tab: Tab = TABS.some((t) => t.value === raw) ? raw : "LIVE";

  let all: Auction[] = [];
  let fetchError: string | null = null;
  try {
    all = await backend.publicGet<Auction[]>("/auctions");
  } catch (err) {
    fetchError = err instanceof Error ? err.message : "Failed to load auctions.";
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
    LIVE: "Nothing live right now. Check the Upcoming tab.",
    UPCOMING: "No upcoming auctions scheduled.",
    ENDED: "No closed auctions yet — the recent ones will land here.",
  };

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-4">
          <h1 className="text-2xl font-black">Auctions</h1>
          <p className="text-sm text-slate-400">
            Lowest-unique-bid auctions. Browse below — sign in to place bids
            and watch your standing update in real time.
          </p>
        </div>

        {/* Tab bar — mirrors the Android HomeScreen's filter chip row.
            The active tab gets a brand-coloured underline + bold weight;
            inactive tabs stay quiet. Counts make the catalog scannable
            at a glance ("Are there even Upcoming ones today?"). */}
        <nav className="mb-5 flex items-center gap-1 border-b border-[var(--color-divider)]">
          {TABS.map((t) => {
            const active = t.value === tab;
            const count = t.count(all);
            return (
              <Link
                key={t.value}
                href={`/auctions?tab=${t.value}`}
                className={cn(
                  "relative px-3 py-2 text-sm font-semibold transition",
                  active
                    ? "text-cyan-300"
                    : "text-slate-400 hover:text-slate-200",
                )}
              >
                {t.label}
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
            Couldn&apos;t reach the auctions service: {fetchError}.
          </Card>
        )}

        {filtered.length === 0 ? (
          <Card className="text-sm text-slate-500">{empty[tab]}</Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((a) => (
              <AuctionTile key={a.id} a={a} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function AuctionTile({ a }: { a: Auction }) {
  const hero = a.imageUrls[0];
  return (
    <Link
      href={`/auctions/${a.id}`}
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
              <StatusBadge status={a.status} />
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
              Retail ₹{Number(a.retailPrice).toLocaleString("en-IN")}
            </span>
            <span>
              <TimeHint auction={a} />
            </span>
          </div>
          {/* Closed-tab winners get their own row so they stand out from
              the generic price/time line above. */}
          {a.status === "ENDED" && (
            <WinnerLine auction={a} />
          )}
        </div>
      </Card>
    </Link>
  );
}

function WinnerLine({ auction }: { auction: Auction }) {
  if (!auction.winner) {
    return (
      <div className="mt-2 text-[11px] text-slate-500">No winner declared.</div>
    );
  }
  return (
    <div className="mt-2 flex items-center gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2 py-1 text-[11px] text-emerald-200">
      <span>🏆</span>
      <span className="truncate">
        <span className="font-semibold">@{auction.winner.username}</span>{" "}
        {auction.winnerAmount && (
          <>won at ₹{Number(auction.winnerAmount).toFixed(2)}</>
        )}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: Auction["status"] }) {
  if (status === "LIVE") return <Badge tone="live">Live</Badge>;
  if (status === "UPCOMING") return <Badge tone="upcoming">Upcoming</Badge>;
  return <Badge tone="ended">Ended</Badge>;
}

function TimeHint({ auction }: { auction: Auction }) {
  const now = Date.now();
  if (auction.status === "UPCOMING") {
    const start = auction.startsAt ? new Date(auction.startsAt).getTime() : null;
    if (!start) return <>starts soon</>;
    return <>starts {relativeTime(start - now, "in")}</>;
  }
  if (auction.status === "LIVE") {
    const ends = new Date(auction.endsAt).getTime();
    if (ends <= now) return <>ending…</>;
    return <>ends {relativeTime(ends - now, "in")}</>;
  }
  if (auction.closedAt) {
    return <>ended {relativeTime(now - new Date(auction.closedAt).getTime(), "ago")}</>;
  }
  return <>ended</>;
}
