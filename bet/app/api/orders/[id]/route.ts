import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { publish, Channels } from "@/lib/pubsub";
import { snapPrice, snapShares } from "@/lib/orderbook";

/**
 * Cancel a still-open order. Atomically: refund the unfilled portion of the
 * coin lock (BUY) or release the locked shares back onto the user's
 * Position (SELL). Idempotent — cancelling a FILLED / CANCELLED order is a
 * no-op rather than an error.
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const u = await getAuthedUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const result = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id } });
    if (!order) return { ok: false as const, error: "not_found", status: 404 };
    if (order.userId !== u.id) return { ok: false as const, error: "forbidden", status: 403 };
    if (order.status === "FILLED" || order.status === "CANCELLED") {
      return { ok: true as const, alreadyClosed: true, marketId: order.marketId };
    }

    if (order.remaining > 1e-9) {
      if (order.side === "BUY") {
        const refund = Math.ceil(order.remaining * order.limitPrice);
        await tx.wallet.update({
          where: { userId: u.id },
          data: { balance: { increment: refund } },
        });
      } else {
        await tx.position.update({
          where: {
            userId_marketId_outcome: {
              userId: u.id,
              marketId: order.marketId,
              outcome: order.outcome,
            },
          },
          data: { locked: { decrement: order.remaining } },
        });
      }
    }

    await tx.order.update({
      where: { id: order.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), remaining: 0 },
    });

    return { ok: true as const, marketId: order.marketId };
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  if (result.marketId) {
    publish(Channels.market(result.marketId), { type: "book", at: Date.now() });
  }
  return NextResponse.json({ ok: true });
}

const PatchBody = z.object({
  limitPrice: z.number().gt(0).lt(1).optional(),
  shares: z.number().gt(0).max(1_000_000).optional(),
});

/**
 * Replace (modify) an open / partially-filled order. Atomically:
 *   1. Cancel the existing order, releasing its reservation.
 *   2. Create a new OPEN order at the new params, re-reserving funds/shares
 *      for the new size.
 *
 * Important caveat: this is a *reposition*, NOT a fresh place. The new
 * order is added as a resting maker only — it does NOT walk the book. The
 * normal case (move my resting BUY price 0.55 → 0.50) doesn't cross
 * anything because if a maker was already crossing, the original would
 * have filled. To aggressively cross use cancel + POST /api/orders.
 *
 * The new size cannot exceed the original `remaining` (otherwise the
 * caller should cancel and place a larger fresh order — that path through
 * POST /api/orders runs the matcher and gives them price improvement).
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const u = await getAuthedUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const newPriceRaw = parsed.data.limitPrice;
  const newSharesRaw = parsed.data.shares;
  if (newPriceRaw === undefined && newSharesRaw === undefined) {
    return NextResponse.json({ error: "nothing_to_change" }, { status: 400 });
  }

  const result = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id } });
    if (!order) return { ok: false as const, error: "not_found", status: 404 };
    if (order.userId !== u.id) return { ok: false as const, error: "forbidden", status: 403 };
    if (order.status === "FILLED" || order.status === "CANCELLED") {
      return { ok: false as const, error: "order_closed", status: 409 };
    }

    const market = await tx.market.findUnique({ where: { id: order.marketId } });
    if (!market) return { ok: false as const, error: "market_not_found", status: 404 };
    if (market.status !== "OPEN") {
      return { ok: false as const, error: "market_not_open", status: 409 };
    }
    if (market.endsAt.getTime() <= Date.now()) {
      return { ok: false as const, error: "market_ended", status: 409 };
    }

    const newPrice = newPriceRaw !== undefined ? snapPrice(newPriceRaw) : order.limitPrice;
    const newShares =
      newSharesRaw !== undefined ? snapShares(newSharesRaw) : order.remaining;
    if (!Number.isFinite(newPrice) || !Number.isFinite(newShares)) {
      return { ok: false as const, error: "invalid_input", status: 400 };
    }
    if (newShares > order.remaining + 1e-9) {
      // Bigger size requires a fresh place + matcher run.
      return { ok: false as const, error: "size_increase_requires_new_order", status: 400 };
    }

    // 1. Release the old reservation entirely.
    if (order.remaining > 1e-9) {
      if (order.side === "BUY") {
        const refund = Math.ceil(order.remaining * order.limitPrice);
        await tx.wallet.update({
          where: { userId: u.id },
          data: { balance: { increment: refund } },
        });
      } else {
        await tx.position.update({
          where: {
            userId_marketId_outcome: {
              userId: u.id,
              marketId: order.marketId,
              outcome: order.outcome,
            },
          },
          data: { locked: { decrement: order.remaining } },
        });
      }
    }
    await tx.order.update({
      where: { id: order.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), remaining: 0 },
    });

    // 2. Re-reserve at the new size + price for the replacement.
    if (order.side === "BUY") {
      const cost = Math.ceil(newShares * newPrice);
      const wallet = await tx.wallet.findUnique({ where: { userId: u.id } });
      if (!wallet || wallet.balance < cost) {
        return { ok: false as const, error: "insufficient_coins", status: 400 };
      }
      await tx.wallet.update({
        where: { userId: u.id },
        data: { balance: { decrement: cost } },
      });
    } else {
      const pos = await tx.position.findUnique({
        where: {
          userId_marketId_outcome: {
            userId: u.id,
            marketId: order.marketId,
            outcome: order.outcome,
          },
        },
      });
      const available = (pos?.shares ?? 0) - (pos?.locked ?? 0);
      if (available + 1e-9 < newShares) {
        return { ok: false as const, error: "insufficient_shares", status: 400 };
      }
      await tx.position.update({
        where: { id: pos!.id },
        data: { locked: { increment: newShares } },
      });
    }

    const replacement = await tx.order.create({
      data: {
        userId: u.id,
        marketId: order.marketId,
        outcome: order.outcome,
        side: order.side,
        limitPrice: newPrice,
        shares: newShares,
        remaining: newShares,
        status: "OPEN",
      },
    });

    return { ok: true as const, marketId: order.marketId, newOrderId: replacement.id };
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  publish(Channels.market(result.marketId), { type: "book", at: Date.now() });
  return NextResponse.json({ ok: true, newOrderId: result.newOrderId });
}
