import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { priceYes } from "@/lib/amm";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  // The trade panel polls by slug (URL-friendly), but admin code may pass the
  // database id. findFirst with OR covers both without a second round-trip.
  const { id } = await ctx.params;
  const market = await db.market.findFirst({
    where: { OR: [{ id }, { slug: id }] },
    select: {
      id: true,
      status: true,
      yesShares: true,
      noShares: true,
      volumeCoins: true,
      endsAt: true,
    },
  });
  if (!market) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const p = priceYes({ yesShares: market.yesShares, noShares: market.noShares });
  return NextResponse.json({
    id: market.id,
    status: market.status,
    yesShares: market.yesShares,
    noShares: market.noShares,
    yesPrice: p,
    noPrice: 1 - p,
    volumeCoins: market.volumeCoins,
    endsAt: market.endsAt,
  });
}
