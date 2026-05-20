import Link from "next/link";
import type { Metadata } from "next";
import { backend, BackendApiError } from "@/lib/backend";

export const dynamic = "force-dynamic";

interface AuctionRow {
  id: string;
  title: string;
  description: string;
  imageUrls: string[];
  retailPrice: string;
  coinsPerBid: number;
  endsAt: string;
  status: "UPCOMING" | "LIVE" | "ENDED";
}

/**
 * Public auction share page (Roadmap §F-USER-9).
 *
 * Anyone with a link can see the listing — no auth required. The
 * page renders a single SKU with hero image + retail price + an
 * obvious signup CTA. Open Graph + Twitter Card meta tags let
 * WhatsApp / X / FB / iMessage produce a rich preview when the link
 * is pasted.
 *
 * Why a separate `/share/[id]` route instead of the existing
 * authenticated `/auctions/[id]` page:
 *
 *   1. The auctions detail page assumes the visitor has a session
 *      (it shows their bid history, the bid-placement panel, etc.).
 *      Stripping that conditional rendering would couple two
 *      different audiences into one component.
 *   2. The OG/Twitter meta is intentionally minimal — a single
 *      image, a short blurb, no JS. Crawlers like simplicity.
 *   3. Signup attribution: a future ?ref=<referralCode> param can
 *      attach to the page URL and pre-fill the signup form.
 */

async function fetchAuction(id: string): Promise<AuctionRow | null> {
  try {
    return await backend.publicGet<AuctionRow>(`/auctions/${id}`);
  } catch (err) {
    if (err instanceof BackendApiError && err.status === 404) return null;
    throw err;
  }
}

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const auction = await fetchAuction(params.id);
  if (!auction) {
    return { title: "Auction not found · Kalki Auctions" };
  }
  const cover = auction.imageUrls[0] ?? "/og-default.png";
  const desc = `Bid on ${auction.title} — retail ₹${Number(auction.retailPrice).toLocaleString("en-IN")}. Lowest unique bid wins.`;
  return {
    title: `${auction.title} · Kalki Auctions`,
    description: desc,
    openGraph: {
      title: auction.title,
      description: desc,
      images: [{ url: cover, width: 1200, height: 630, alt: auction.title }],
      type: "website",
      siteName: "Kalki Auctions",
    },
    twitter: {
      card: "summary_large_image",
      title: auction.title,
      description: desc,
      images: [cover],
    },
  };
}

export default async function SharePage({ params }: { params: { id: string } }) {
  const auction = await fetchAuction(params.id);

  if (!auction) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 text-slate-200">
        <div className="text-center">
          <h1 className="text-2xl font-black">Auction not found</h1>
          <p className="mt-2 text-sm text-slate-400">
            This auction may have ended or been removed.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400"
          >
            Browse live auctions
          </Link>
        </div>
      </main>
    );
  }

  const cover = auction.imageUrls[0] ?? null;
  const retailFormatted = Number(auction.retailPrice).toLocaleString("en-IN");
  const ended = auction.status === "ENDED" || new Date(auction.endsAt).getTime() < Date.now();

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-slate-100">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6 flex items-center gap-2 text-xs uppercase tracking-wider text-amber-200/80">
          <span className="rounded bg-amber-500/15 px-2 py-0.5">Kalki Auctions</span>
          <span>Lowest unique bid wins</span>
        </div>

        {cover && (
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cover} alt={auction.title} className="aspect-[16/9] w-full object-cover" />
          </div>
        )}

        <h1 className="mt-6 text-3xl font-black tracking-tight">{auction.title}</h1>
        <p className="mt-2 text-sm text-slate-400">{auction.description}</p>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Retail price" value={`₹${retailFormatted}`} />
          <Stat label="Coins per bid" value={String(auction.coinsPerBid)} />
          <Stat
            label={ended ? "Ended" : "Closes"}
            value={new Date(auction.endsAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
          />
        </div>

        <div className="mt-8 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-5 text-center">
          <h2 className="text-lg font-bold text-amber-100">
            {ended ? "Auction ended" : "Make your bid"}
          </h2>
          <p className="mt-1 text-xs text-amber-200/80">
            {ended
              ? "Sign up to be ready for the next one."
              : "Pick a unique low price others won't think of. Each bid costs coins."}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <Link
              href={ended ? "/" : `/auctions/${auction.id}`}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-400"
            >
              {ended ? "See live auctions" : "Open auction"}
            </Link>
            <Link
              href="/signup"
              className="rounded-lg border border-amber-400/40 px-4 py-2 text-sm font-medium text-amber-100 hover:bg-amber-500/10"
            >
              Sign up
            </Link>
          </div>
        </div>

        <p className="mt-10 text-center text-[11px] text-slate-500">
          Play responsibly. 18+ only. 1800-599-0019.
        </p>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-bold text-slate-100">{value}</div>
    </div>
  );
}
