import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { publish, Channels } from "@/lib/pubsub";

/**
 * DELETE /api/admin/orders/:id
 *
 * Admin-force-cancel a single open order. Atomically releases the
 * unfilled reservation (coin refund for BUYs, share unlock for SELLs)
 * and flips the order to CANCELLED. Mirrors the user-facing DELETE at
 * `/api/orders/:id` minus the owner check, plus an AdminLog row so we
 * have a trail of every admin-initiated cancel.
 *
 * Idempotent: cancelling an already FILLED / CANCELLED order is a
 * 200 no-op (logs `already_closed=true` in metadata).
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const u = await getAuthedUser();
  if (!u?.isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;

  const result = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id } });
    if (!order) {
      return { ok: false as const, status: 404, error: "not_found" };
    }
    if (order.status === "FILLED" || order.status === "CANCELLED") {
      return {
        ok: true as const,
        marketId: order.marketId,
        userId: order.userId,
        alreadyClosed: true,
        side: order.side,
        outcome: order.outcome,
      };
    }

    if (order.remaining > 1e-9) {
      if (order.side === "BUY") {
        const refund = Math.ceil(order.remaining * order.limitPrice);
        await tx.wallet.update({
          where: { userId: order.userId },
          data: { balance: { increment: refund } },
        });
      } else {
        await tx.position.update({
          where: {
            userId_marketId_outcome: {
              userId: order.userId,
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

    await tx.adminLog.create({
      data: {
        adminId: u.id,
        action: "order.force_cancel",
        targetId: order.id,
        metadata: {
          marketId: order.marketId,
          userId: order.userId,
          outcome: order.outcome,
          side: order.side,
          limitPrice: order.limitPrice,
          remaining: order.remaining,
        },
      },
    });

    return {
      ok: true as const,
      marketId: order.marketId,
      userId: order.userId,
      side: order.side,
      outcome: order.outcome,
      alreadyClosed: false,
    };
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  if (!result.alreadyClosed) {
    publish(Channels.market(result.marketId), { type: "book", at: Date.now() });
  }
  return NextResponse.json({ ok: true, alreadyClosed: result.alreadyClosed });
}
