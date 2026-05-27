import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSessionToken } from "@/lib/session";
import { backend, BackendUnauthorized, type Auction } from "@/lib/backend";
import { detectCountry, type CountryCode } from "@/lib/locale-detect";
import { loadFxRates } from "@/lib/fx";
import {
  DEFAULT_LOCALE,
  buildLocalizedMetadata,
  isLocale,
  localizedPath,
  t,
  type Locale,
} from "@/lib/i18n";
import { HubClient, type HubAuction, type HubMarket } from "./hub-client";

export const dynamic = "force-dynamic";

/**
 * Locale-aware SEO metadata for the hub. Marked `noindex` because the
 * hub requires sign-in — letting Google crawl it just adds spam to
 * the index. The title still localises so any external preview (e.g.
 * a chat unfurl from a hub URL) reads in the right language.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  return buildLocalizedMetadata({
    locale,
    path: "/",
    title: t("meta.homeTitle", locale),
    description: t("meta.homeDescription", locale),
    noindex: true, // Hub requires sign-in; keep out of the index.
  });
}

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
 *   1. Validate the URL locale segment — unknown values 404 the same
 *      way every other [locale] route does.
 *   2. Gate on the session — unauthenticated users land at the
 *      locale-prefixed /login.
 *   3. Resolve the user (username, coinBalance, isAdmin) via the
 *      auctions backend's /auth/me.
 *   4. Fetch live auctions from this app's NestJS backend and pick
 *      one at random for the featured auction card. The rest fill
 *      the "Hot right now" chip row.
 *   5. Fetch trending markets from the Exchange's public REST
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
 *
 * The URL locale and the in-page locale-switcher are deliberately
 * separate: the URL locale is the small four-language SEO set (en /
 * pt / es / fr) that the App Router validates and Google indexes,
 * while the in-page switcher offers the broader 11-market roster
 * (with their own currency + number formatting). The switcher
 * writes the `kalki_locale` cookie, which `detectCountry()` reads
 * for the initial country on every render.
 */
export default async function HubPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const lp = (path: string) => localizedPath(path, locale);

  const token = await getSessionToken();
  if (!token) redirect(`${lp("/login")}?next=${encodeURIComponent(lp("/"))}`);

  let me: Me | null = null;
  try {
    me = await backend.authed(token).get<Me>("/auth/me");
  } catch (err) {
    if (err instanceof BackendUnauthorized) {
      redirect(`${lp("/login")}?next=${encodeURIComponent(lp("/"))}`);
    }
    throw err;
  }

  // Run upstream calls in parallel; either is allowed to fail
  // independently — the design has loading-state cards for both.
  // The FX rate fetch is added to the same batch so it's pulled at
  // the cost of one extra cached HTTP round-trip on cold revalidate
  // (6h cache window, so most requests hit Next's data cache).
  const settled = await Promise.allSettled([
    backend.publicGet<Auction[]>("/auctions"),
    fetchTrendingMarkets(),
    detectCountry(),
    loadFxRates(),
  ]);
  const auctionsResult: Auction[] =
    settled[0].status === "fulfilled" ? settled[0].value : [];
  const marketsResult: HubMarket[] =
    settled[1].status === "fulfilled" ? settled[1].value : [];
  const country: CountryCode =
    settled[2].status === "fulfilled" ? settled[2].value : "IN";
  const fxRates =
    settled[3].status === "fulfilled" ? settled[3].value.rates : {};

  const liveAuctions = auctionsResult.filter((a) => a.status === "LIVE");
  const shuffledAuctions = shuffle(liveAuctions);
  const featuredAuction = shuffledAuctions[0] ?? null;
  const recentAuctions = shuffledAuctions
    .slice(0, 4)
    .map((a) => toHubAuction(a, lp));

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
      ? lp(`/auctions/${featuredAuction.id}`)
      : lp("/auctions");
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
      auction={featuredAuction ? toHubAuction(featuredAuction, lp) : null}
      market={featuredMarket}
      links={{
        auction: auctionHref,
        auctionsList: lp("/auctions"),
        aviator: aviatorHref,
        exchange: exchangeHref,
        wallet: walletHref,
        home: lp("/"),
        watchlist: lp("/me/watchlist"),
        notifications: lp("/notifications"),
        profile: lp("/profile"),
      }}
      recentAuctions={recentAuctions}
      recentMarkets={recentMarkets}
      fxRates={fxRates}
    />
  );
}

function toHubAuction(a: Auction, lp: (path: string) => string): HubAuction {
  return {
    id: a.id,
    title: a.title,
    imageUrl: a.imageUrls[0] ?? null,
    retailPrice: a.retailPrice,
    endsAt: a.endsAt,
    href: lp(`/auctions/${a.id}`),
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
