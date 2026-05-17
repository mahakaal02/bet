import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildLadder } from "@/lib/orderbook";
import { getAuthedUser } from "@/lib/auth";
import type { Outcome } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * Returns the YES + NO ladder views for a market. If `?mine=1` the response
 * also includes the caller's open orders so the trade panel can show
 * "you · 100 @ 0.55" inline with the ladder.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const market = await db.market.findFirst({
    where: { OR: [{ id }, { slug: id }] },
    select: { id: true, status: true },
  });
  if (!market) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const orders = await db.order.findMany({
    where: {
      marketId: market.id,
      status: { in: ["OPEN", "PARTIAL"] },
    },
    select: {
      id: true,
      userId: true,
      side: true,
      outcome: true,
      limitPrice: true,
      remaining: true,
      createdAt: true,
    },
  });

  const partition = (outcome: Outcome) =>
    orders.filter((o) => o.outcome === outcome);

  const yesLadder = buildLadder(
    partition("YES").map((o) => ({
      id: o.id,
      userId: o.userId,
      side: o.side,
      limitPrice: o.limitPrice,
      remaining: o.remaining,
      createdAt: o.createdAt,
    })),
  );
  const noLadder = buildLadder(
    partition("NO").map((o) => ({
      id: o.id,
      userId: o.userId,
      side: o.side,
      limitPrice: o.limitPrice,
      remaining: o.remaining,
      createdAt: o.createdAt,
    })),
  );

  let mine: typeof orders | undefined;
  const url = new URL(req.url);
  if (url.searchParams.get("mine") === "1") {
    const me = await getAuthedUser();
    if (me) mine = orders.filter((o) => o.userId === me.id);
  }

  return NextResponse.json({
    marketId: market.id,
    status: market.status,
    yes: yesLadder,
    no: noLadder,
    ...(mine && { mine }),
  });
}
