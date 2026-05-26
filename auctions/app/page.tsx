import { redirect } from "next/navigation";
import { getSessionToken } from "@/lib/session";
import { backend, BackendUnauthorized, type Auction } from "@/lib/backend";
import { detectCountry, type CountryCode } from "@/lib/locale-detect";
import { HubClient, type HubAuction, type HubMarket } from "./hub-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kalki Hub" };

interface Me {
  username: string;
  email: string | null;
  coinBalance: number;
  isAdmin: boolean;
}

interface TrendingResponse {
  markets: HubMarket[];
}

/** Server-side base URL for the Exchange. The browser-side helper
 *  (`lib/exchange-url.ts`) picks the host at runtime; on the server
 *  we can't read window.location, so we read an explicit env var and
 *  fall back to the dev port. */
function exchangeBaseServer(): string {
  return (process.env.NEXT_PUBLIC_EXCHANGE_URL ?? "http://localhost:3100").replace(
    /\/$/,
    "",
  );
}

function aviatorBaseServer(): string {
  return (process.env.NEXT_PUBLIC_AVIATOR_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

function adminBaseServer(): string {
  return (process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:4173").replace(
    /\/$/,
    "",
  );
}

/**
 * Landing hub for the three Kalki products.
 *
 * Drives the new Hub design (see `hub-client.tsx`). Server-side
 * responsibilities:
 *
 *   1. Gate on the session — unauthenticated users land at /login.
 *   2. Resolve the user (username, coinBalance, isAdmin) via the
 *      auctions backend's /auth/me.
 *   3. Fetch live auctions from this app's NestJS backend and pick
 *      one at random for the featured auction card. The rest fill
 *      the "Hot right now" chip row.
 *   4. Fetch trending markets from the Exchange's public REST
 *      endpoint (`/api/markets/trending`) and pick one at random for
 *      the featured market card. The rest fill the chip row alongside
 *      auctions.
 *
 * The featured-card selection is intentionally randomised per render
 * — keeps the hub feeling alive and surfaces different auctions/
 * markets to different users on the same beat. If the upstream calls
 * fail the card falls back to its loading placeholder (the design
 * already accounts for null data).
 *
 * Game CTAs (`Place bid`, `Take off`, `Take a side`) are wired through
 * `HubLinks` — each link carries the SSO `?token=…` query string so
 * the receiving app's TokenBridge can sign the user in without a
 * second login round-trip. Admin users get routed to the admin
 * consoles for each property instead.
 */
export default async function HubPage() {
  const token = await getSessionToken();
  if (!token) redirect("/login?next=/");

  let me: Me | null = null;
  try {
    me = await backend.authed(token).get<Me>("/auth/me");
  } catch (err) {
    if (err instanceof BackendUnauthorized) redirect("/login?next=/");
    throw err;
  }

  // Run upstream calls in parallel; either is allowed to fail
  // independently — the design has loading-state cards for both.
  const settled = await Promise.allSettled([
    backend.publicGet<Auction[]>("/auctions"),
    fetchTrendingMarkets(),
    detectCountry(),
  ]);
  const auctionsResult: Auction[] =
    settled[0].status === "fulfilled" ? settled[0].value : [];
  const marketsResult: HubMarket[] =
    settled[1].status === "fulfilled" ? settled[1].value : [];
  const country: CountryCode =
    settled[2].status === "fulfilled" ? settled[2].value : "IN";

  const liveAuctions = auctionsResult.filter((a) => a.status === "LIVE");
  const shuffledAuctions = shuffle(liveAuctions);
  const featuredAuction = shuffledAuctions[0] ?? null;
  const recentAuctions = shuffledAuctions.slice(0, 4).map(toHubAuction);

  const shuffledMarkets = shuffle(marketsResult);
  const featuredMarket = shuffledMarkets[0] ?? null;
  const recentMarkets = shuffledMarkets.slice(0, 4);

  const tokenQs = `?token=${encodeURIComponent(token)}`;
  const isAdmin = !!me?.isAdmin;
  const adminBase = adminBaseServer();
  const aviatorBase = aviatorBaseServer();
  const exchangeBase = exchangeBaseServer();

  // Admin → console links; player → game deep-links.
  const auctionHref = isAdmin
    ? `${adminBase}/auctions${tokenQs}`
    : featuredAuction
      ? `/auctions/${featuredAuction.id}`
      : "/auctions";
  const aviatorHref = isAdmin
    ? `${adminBase}/aviator/analytics${tokenQs}`
    : `${aviatorBase}/${tokenQs}`;
  const exchangeHref = isAdmin
    ? `${exchangeBase}/admin${tokenQs}`
    : featuredMarket
      ? `${exchangeBase}/markets/${featuredMarket.slug}${tokenQs}`
      : `${exchangeBase}/${tokenQs}`;
  const walletHref = `${exchangeBase}/wallet${tokenQs}`;

  return (
    <HubClient
      initialCountry={country}
      user={{
        username: me?.username ?? "user",
        coinBalance: me?.coinBalance ?? 0,
        isAdmin,
      }}
      auction={featuredAuction ? toHubAuction(featuredAuction) : null}
      market={featuredMarket}
      links={{
        auction: auctionHref,
        auctionsList: "/auctions",
        aviator: aviatorHref,
        exchange: exchangeHref,
        wallet: walletHref,
      }}
      recentAuctions={recentAuctions}
      recentMarkets={recentMarkets}
    />
  );
}

function toHubAuction(a: Auction): HubAuction {
  return {
    id: a.id,
    title: a.title,
    imageUrl: a.imageUrls[0] ?? null,
    retailPrice: a.retailPrice,
    endsAt: a.endsAt,
  };
}

/** Fisher-Yates. We re-shuffle on every render so the featured card
 *  cycles between auctions/markets without any client-side state. */
function shuffle<T>(input: T[]): T[] {
  const out = input.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Server-side fetch of the Exchange's trending-markets feed. The
 *  Exchange is a separate origin (different Next.js process), so we
 *  go through its public REST endpoint rather than its Prisma client.
 *  Failures collapse to an empty list — the hub's market card has a
 *  loading placeholder. */
async function fetchTrendingMarkets(): Promise<HubMarket[]> {
  try {
    const res = await fetch(`${exchangeBaseServer()}/api/markets/trending?limit=10`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as TrendingResponse;
    return Array.isArray(body.markets) ? body.markets : [];
  } catch {
    return [];
  }
}
