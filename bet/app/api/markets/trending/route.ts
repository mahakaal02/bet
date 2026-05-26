import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { priceYes } from "@/lib/amm";

/**
 * Public read of the top trending OPEN markets. Powers the Kalki hub's
 * Exchange card (`auctions/app/page.tsx`), which is a separate Next.js
 * origin and therefore can't query our Prisma client directly.
 *
 *   GET /api/markets/trending?limit=10
 *   → { markets: [{ id, slug, title, yesCents, noCents,
 *                   liquidityCoins, volumeCoins, traders, endsAt }] }
 *
 * Sorted by `trendingScore` (exponentially-decayed volume, refreshed by
 * the scheduler) with `volumeCoins` as a deterministic tiebreaker. No
 * auth required — this is the same shape we'd expose to a marketing
 * embed or status page.
 *
 * CORS is open because the hub fetches this server-side most of the
 * time, but a future client-side widget shouldn't have to add a proxy.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? "10");
  const limit = Number.isFinite(rawLimit)
    ? Math.min(20, Math.max(1, Math.floor(rawLimit)))
    : 10;

  const markets = await db.market.findMany({
    where: { status: "OPEN" },
    orderBy: [{ trendingScore: "desc" }, { volumeCoins: "desc" }],
    take: limit,
    select: {
      id: true,
      slug: true,
      title: true,
      yesShares: true,
      noShares: true,
      volumeCoins: true,
      endsAt: true,
    },
  });

  // Distinct trader count per market. Position has a unique
  // (userId, marketId, outcome) index, so a user with both YES and NO
  // legs would otherwise be double-counted — `distinct: ['userId']`
  // collapses that. The N+1 is bounded by `limit` ≤ 20.
  const traders = await Promise.all(
    markets.map((m) =>
      db.position
        .findMany({
          where: { marketId: m.id, shares: { gt: 0 } },
          distinct: ["userId"],
          select: { userId: true },
        })
        .then((rs) => rs.length),
    ),
  );

  const items = markets.map((m, i) => {
    const yes = priceYes({ yesShares: m.yesShares, noShares: m.noShares });
    return {
      id: m.id,
      slug: m.slug,
      title: m.title,
      yesCents: Math.round(yes * 100),
      noCents: Math.round((1 - yes) * 100),
      liquidityCoins: Math.round(m.yesShares + m.noShares),
      volumeCoins: m.volumeCoins,
      traders: traders[i],
      endsAt: m.endsAt.toISOString(),
    };
  });

  return NextResponse.json(
    { markets: items },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=15, stale-while-revalidate=60",
      },
    },
  );
}
