import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { priceYes } from "@/lib/amm";
import { groupDisplayPrices } from "@/lib/market-group";

/**
 * Public read of a single group + its child markets, ranked.
 *
 *   GET /api/market-groups/:idOrSlug
 *   → { group, children: [...ranked], normalized }
 *
 * Accepts id OR slug (mirrors /api/markets/[id]/state). Children are ranked by
 * RAW YES price desc; `normalizedPct` is share-of-100 for EXCLUSIVE groups,
 * raw YES% otherwise. Prices are computed live from each child's reserves —
 * the underlying markets are untouched.
 */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const group = await db.marketGroup.findFirst({
    where: { OR: [{ id }, { slug: id }] },
    include: {
      markets: {
        select: {
          id: true,
          slug: true,
          title: true,
          status: true,
          resolvedAs: true,
          yesShares: true,
          noShares: true,
          volumeCoins: true,
          groupSortOrder: true,
          endsAt: true,
        },
      },
    },
  });
  if (!group) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const exclusive = group.type === "EXCLUSIVE";
  const priced = group.markets.map((m) => ({
    market: m,
    yesPrice: priceYes({ yesShares: m.yesShares, noShares: m.noShares }),
  }));
  const display = groupDisplayPrices(
    priced.map((p) => ({ marketId: p.market.id, yesPrice: p.yesPrice })),
    exclusive,
  );
  const pctById = new Map(display.map((d) => [d.marketId, d.normalizedPct]));

  const children = priced
    .map(({ market: m, yesPrice }) => ({
      marketId: m.id,
      slug: m.slug,
      title: m.title,
      status: m.status,
      resolvedAs: m.resolvedAs,
      yesShares: m.yesShares,
      noShares: m.noShares,
      yesPrice,
      noPrice: 1 - yesPrice,
      normalizedPct: pctById.get(m.id) ?? 0,
      volumeCoins: m.volumeCoins,
      groupSortOrder: m.groupSortOrder,
      endsAt: m.endsAt,
    }))
    .sort(
      (a, b) =>
        b.yesPrice - a.yesPrice ||
        (a.groupSortOrder ?? 0) - (b.groupSortOrder ?? 0) ||
        b.volumeCoins - a.volumeCoins,
    );

  return NextResponse.json({
    group: {
      id: group.id,
      slug: group.slug,
      title: group.title,
      description: group.description,
      category: group.category,
      type: group.type,
      status: group.status,
      resolvedWinnerMarketId: group.resolvedWinnerMarketId,
      resolvedAt: group.resolvedAt,
    },
    children,
    normalized: exclusive,
  });
}
