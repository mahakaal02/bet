/**
 * Sweep every OPEN / PARTIAL order on a market and release whatever it had
 * locked — BUYs get `ceil(remaining * limitPrice)` coins refunded to the
 * wallet, SELLs get `remaining` shares released back onto `Position.locked`.
 *
 * Two callers need this:
 *   1. The scheduler when a market crosses `endsAt` (OPEN → CLOSED). Without
 *      this sweep, locked BUY coins would stay debited from the wallet
 *      indefinitely.
 *   2. The admin resolve route, in case the admin resolves an OPEN market
 *      before the scheduler runs (skipping the CLOSED state). Idempotent —
 *      calling on a market whose orders were already cancelled is a no-op
 *      because the findMany returns nothing.
 *
 * Math mirrors the user-facing DELETE /api/orders/[id] handler exactly so
 * a manual cancel and an automatic close produce identical balance state.
 *
 * The caller MUST be inside a $transaction; the lock release and the order
 * status flip must commit atomically.
 */
import type { Prisma } from "@prisma/client";

export interface OrderRefundResult {
  cancelledCount: number;
  refundedCoins: number;
  releasedShares: number;
  affectedUserIds: string[];
}

export async function cancelOpenOrdersForMarket(
  tx: Prisma.TransactionClient,
  marketId: string,
): Promise<OrderRefundResult> {
  const open = await tx.order.findMany({
    where: { marketId, status: { in: ["OPEN", "PARTIAL"] } },
  });

  let refundedCoins = 0;
  let releasedShares = 0;
  const affected = new Set<string>();
  const now = new Date();

  for (const o of open) {
    if (o.remaining > 1e-9) {
      if (o.side === "BUY") {
        const refund = Math.ceil(o.remaining * o.limitPrice);
        if (refund > 0) {
          await tx.wallet.update({
            where: { userId: o.userId },
            data: { balance: { increment: refund } },
          });
          refundedCoins += refund;
        }
      } else {
        await tx.position.update({
          where: {
            userId_marketId_outcome: {
              userId: o.userId,
              marketId: o.marketId,
              outcome: o.outcome,
            },
          },
          data: { locked: { decrement: o.remaining } },
        });
        releasedShares += o.remaining;
      }
    }
    await tx.order.update({
      where: { id: o.id },
      data: { status: "CANCELLED", cancelledAt: now, remaining: 0 },
    });
    affected.add(o.userId);
  }

  return {
    cancelledCount: open.length,
    refundedCoins,
    releasedShares,
    affectedUserIds: [...affected],
  };
}
