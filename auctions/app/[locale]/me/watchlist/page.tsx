import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { getSessionToken } from "@/lib/session";
import {
  backend,
  BackendApiError,
  BackendUnauthorized,
  type WatchlistListResponse,
} from "@/lib/backend";
import { relativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "My watchlist · Kalki Auctions" };

/**
 * Server-rendered watchlist page. Buckets are ordered LIVE →
 * UPCOMING → other; the LIVE bucket sorts ending-soonest so the
 * user sees the row that needs attention first.
 *
 * Outbid notifications already wire to these rows via
 * `OutbidListenerService` (PR-NOTIFY-1) — turning `watchlist.enabled`
 * + `watchlist.outbid_notifications` ON in the admin Feature Flags
 * page makes those notifications start firing.
 *
 * No tile-level WatchToggle here — the tile being on the list IS
 * the "watching" state. The link drops the user into the detail
 * page where they can unwatch with one click.
 */
export default async function MyWatchlistPage() {
  const token = await getSessionToken();
  if (!token) redirect("/login?next=/me/watchlist");

  let data: WatchlistListResponse | null = null;
  let unavailable = false;
  let errorMessage: string | null = null;
  try {
    data = await backend.authed(token).get<WatchlistListResponse>(
      "/me/watchlist",
    );
  } catch (err) {
    if (err instanceof BackendUnauthorized) redirect("/login?next=/me/watchlist");
    if (err instanceof BackendApiError && err.status === 403) {
      // Feature flag is off — show the friendly "coming soon" card
      // instead of an error.
      unavailable = true;
    } else if (err instanceof BackendApiError) {
      errorMessage = err.message;
    } else {
      errorMessage = "Couldn't reach the auctions service.";
    }
  }

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-5 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black">My watchlist</h1>
            <p className="text-sm text-slate-400">
              Auctions you&apos;ve starred. Outbid alerts fire when the
              lowest-unique bid moves below yours.
            </p>
          </div>
          {data && (
            <div className="text-right text-xs text-slate-500">
              <div>
                {data.counts.total} / {data.counts.cap} watching
              </div>
              {data.counts.live > 0 && (
                <div className="text-emerald-300">
                  {data.counts.live} live
                </div>
              )}
            </div>
          )}
        </div>

        {unavailable && (
          <Card className="border-cyan-500/30 bg-cyan-500/10 text-sm text-cyan-100">
            Watchlist isn&apos;t enabled yet — an admin can turn it on
            from the Feature Flags page.
          </Card>
        )}

        {errorMessage && (
          <Card className="border-rose-500/30 bg-rose-500/10 text-sm text-rose-200">
            {errorMessage}
          </Card>
        )}

        {data && data.items.length === 0 && (
          <Card className="text-sm text-slate-500">
            You&apos;re not watching any auctions yet. Open an{" "}
            <Link
              href="/auctions"
              className="text-cyan-300 hover:text-cyan-200"
            >
              auction
            </Link>{" "}
            and tap the ★ button to start.
          </Card>
        )}

        {data && data.items.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((item) => (
              <WatchTile key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function WatchTile({ item }: { item: WatchlistListResponse["items"][number] }) {
  const a = item.auction;
  return (
    <Link href={`/auctions/${a.id}`} className="block transition hover:-translate-y-0.5">
      <Card className="overflow-hidden p-0 hover:border-amber-400/40">
        {a.imageUrl ? (
          <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-950">
            <Image
              src={a.imageUrl}
              alt={a.title}
              fill
              sizes="(min-width: 1024px) 24vw, (min-width: 640px) 50vw, 100vw"
              className="object-cover"
              unoptimized
            />
            <div className="absolute left-2 top-2">
              <StatusBadge status={a.status} />
            </div>
            <div className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-md bg-slate-950/80 text-amber-300">
              ★
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
              <TimeHint
                status={a.status}
                startsAt={a.startsAt}
                endsAt={a.endsAt}
              />
            </span>
          </div>
          {item.lastNotifiedAt && (
            <div className="mt-2 text-[10px] text-amber-300/80">
              Last outbid alert {relativeTime(
                Date.now() - new Date(item.lastNotifiedAt).getTime(),
                "ago",
              )}
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}

function StatusBadge({
  status,
}: {
  status: WatchlistListResponse["items"][number]["auction"]["status"];
}) {
  if (status === "LIVE") return <Badge tone="live">Live</Badge>;
  if (status === "UPCOMING") return <Badge tone="upcoming">Upcoming</Badge>;
  return <Badge tone="ended">Ended</Badge>;
}

function TimeHint({
  status,
  startsAt,
  endsAt,
}: {
  status: "LIVE" | "UPCOMING" | "ENDED";
  startsAt: string | null;
  endsAt: string | null;
}) {
  const now = Date.now();
  if (status === "UPCOMING") {
    if (!startsAt) return <>starts soon</>;
    return <>starts {relativeTime(new Date(startsAt).getTime() - now, "in")}</>;
  }
  if (status === "LIVE") {
    if (!endsAt) return <>ending…</>;
    return <>ends {relativeTime(new Date(endsAt).getTime() - now, "in")}</>;
  }
  if (endsAt) {
    return <>ended {relativeTime(now - new Date(endsAt).getTime(), "ago")}</>;
  }
  return <>ended</>;
}
