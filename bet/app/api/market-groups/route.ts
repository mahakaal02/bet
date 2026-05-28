import { NextResponse } from "next/server";
import { Prisma, type MarketCategory, type MarketGroupStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { priceYes } from "@/lib/amm";
import { groupDisplayPrices } from "@/lib/market-group";

/**
 * Public read of market groups (Kalshi-style events).
 *
 *   GET /api/market-groups?featured=1&status=OPEN&category=POLITICS
 *   → { groups: [{ id, slug, title, category, type, status, featured,
 *                  childCount, volumeCoins, leader }] }
 *
 * `leader` is the highest-raw-YES child + its display percent (normalized for
 * EXCLUSIVE groups). Same open-CORS / short-cache contract as
 * /api/markets/trending so the hub can embed it. No auth.
 */
export const dynamic = "force-dynamic";

const STATUSES = ["OPEN", "CLOSED", "RESOLVED", "CANCELLED"];
const CATEGORIES = ["POLITICS", "SPORTS", "CRYPTO", "TECH", "ENTERTAINMENT"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const featured = url.searchParams.get("featured");
  const statusParam = url.searchParams.get("status")?.toUpperCase();
  const categoryParam = url.searchParams.get("category")?.toUpperCase();

  const where: Prisma.MarketGroupWhereInput = {};
  if (featured === "1" || featured === "true") where.featured = true;
  if (statusParam && STATUSES.includes(statusParam)) where.status = statusParam as MarketGroupStatus;
  if (categoryParam && CATEGORIES.includes(categoryParam)) where.category = categoryParam as MarketCategory;

  const groups = await db.marketGroup.findMany({
    where,
    orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
    take: 60,
    select: {
      id: true,
      slug: true,
      title: true,
      category: true,
      type: true,
      status: true,
      featured: true,
      markets: {
        select: { id: true, title: true, yesShares: true, noShares: true, volumeCoins: true },
      },
    },
  });

  const items = groups.map((g) => {
    const children = g.markets.map((m) => ({
      marketId: m.id,
      title: m.title,
      yesPrice: priceYes({ yesShares: m.yesShares, noShares: m.noShares }),
    }));
    const display = groupDisplayPrices(
      children.map((c) => ({ marketId: c.marketId, yesPrice: c.yesPrice })),
      g.type === "EXCLUSIVE",
    );
    const pctById = new Map(display.map((d) => [d.marketId, d.normalizedPct]));

    let leader: { marketId: string; title: string; normalizedPct: number } | null = null;
    for (const c of children) {
      if (!leader || c.yesPrice > children.find((x) => x.marketId === leader!.marketId)!.yesPrice) {
        leader = { marketId: c.marketId, title: c.title, normalizedPct: pctById.get(c.marketId) ?? 0 };
      }
    }

    return {
      id: g.id,
      slug: g.slug,
      title: g.title,
      category: g.category,
      type: g.type,
      status: g.status,
      featured: g.featured,
      childCount: g.markets.length,
      volumeCoins: g.markets.reduce((s, m) => s + m.volumeCoins, 0),
      leader,
    };
  });

  return NextResponse.json(
    { groups: items },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=15, stale-while-revalidate=60",
      },
    },
  );
}
