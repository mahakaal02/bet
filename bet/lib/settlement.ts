import type { Market, Prisma } from "@prisma/client";
import { onResolution } from "@/lib/achievements";
import { splitSettlement } from "@/lib/commission";
import { collectFee } from "@/lib/house";
import { cancelOpenOrdersForMarket } from "@/lib/order-refund";

/**
 * Carries an HTTP status alongside the message so callers (the standalone
 * resolve route + the group-resolve orchestrator) can map a thrown error
 * straight onto a response code. Thrown inside `resolveMarketTx` to abort
 * (and roll back) a settlement transaction.
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ResolveMarketInput {
  marketId: string;
  outcome: "YES" | "NO" | "CANCELLED";
  note?: string | null;
  /** Admin actor id — recorded on the Settlement + AdminLog audit rows. */
  executedById: string;
}

export interface ResolveMarketResult {
  payoutCount: number;
  paidOut: number;
  settlementFee: number;
  unlocksByUser: Map<string, Awaited<ReturnType<typeof onResolution>>>;
  orderRefunds: Awaited<ReturnType<typeof cancelOpenOrdersForMarket>>;
  market: Market;
}

/**
 * Behaviour-preserving extraction of the standalone market-resolution
 * transaction body (formerly inline in
 * `app/api/admin/markets/[id]/resolve/route.ts`).
 *
 * For YES/NO: every position on the winning side is paid out 1 coin per
 * share. For CANCELLED: all positions are refunded their costBasis. The
 * caller MUST run this inside a `db.$transaction(..., { timeout: 30_000 })`
 * so it's all-or-nothing — any throw rolls the whole settlement back and
 * leaves the market untouched.
 *
 * Deliberately does **no** pubsub / SSE fan-out: the post-commit publish
 * must happen AFTER the transaction commits, so the caller owns it (it has
 * the `unlocksByUser` map + `market` in the returned result). Keeping
 * side-effecting I/O out of the tx also lets the group orchestrator settle
 * several children sequentially and fan out once per child afterwards.
 *
 * Throws `HttpError(404, "not_found")` / `HttpError(409, "already_resolved")`
 * exactly like the original inline body did.
 */
export async function resolveMarketTx(
  tx: Prisma.TransactionClient,
  input: ResolveMarketInput,
): Promise<ResolveMarketResult> {
  const { marketId: id, outcome, note, executedById } = input;

  const market = await tx.market.findUnique({ where: { id } });
  if (!market) throw new HttpError(404, "not_found");
  if (market.status === "RESOLVED" || market.status === "CANCELLED") {
    throw new HttpError(409, "already_resolved");
  }

  // Cancel any still-open orders and refund their locked side BEFORE
  // we iterate positions. If the admin resolves an OPEN market (no
  // scheduler tick yet), this is the one place locked BUY coins get
  // returned to the wallet. Idempotent — re-runs on CLOSED markets
  // whose orders the scheduler already cancelled do nothing.
  const orderRefunds = await cancelOpenOrdersForMarket(tx, id);

  const positions = await tx.position.findMany({
    where: { marketId: id, shares: { gt: 0 } },
  });

  let payoutCount = 0;
  let paidOut = 0;
  let totalSettlementFee = 0;
  const unlocksByUser = new Map<string, Awaited<ReturnType<typeof onResolution>>>();

  // Cancellation refunds principal at par and DOES NOT apply the
  // platform's 5% rake — the rake is on profit only, and a refund
  // is not a profit. Winners do pay the rake; losers pay nothing
  // because there's no payout to skim from. See `splitSettlement`
  // in lib/commission.ts for the exact policy.
  const isCancelled = outcome === "CANCELLED";

  for (const pos of positions) {
    let gross = 0;
    if (isCancelled) {
      gross = pos.costBasis;
    } else if (pos.outcome === outcome) {
      // 1 coin per share for the winning side.
      gross = Math.floor(pos.shares);
    }

    const { netPayout, fee } = splitSettlement(gross, pos.costBasis, {
      applyFee: !isCancelled,
    });
    const payout = netPayout;

    if (payout > 0) {
      await tx.wallet.update({
        where: { userId: pos.userId },
        data: { balance: { increment: payout } },
      });
      await tx.transaction.create({
        data: {
          userId: pos.userId,
          delta: payout,
          kind: isCancelled ? "resolution_refund" : "resolution_payout",
          // Unique-index gate: `(kind, reference)` — replaying this
          // resolution call is a no-op because the same reference
          // already exists.
          reference: `${outcome}:${id}:${pos.id}`,
          metadata: {
            marketId: id,
            outcome,
            shares: pos.shares,
            gross,
            fee,
          },
        },
      });
      paidOut += payout;
      payoutCount += 1;
    }

    if (fee > 0) {
      await collectFee(tx, {
        amount: fee,
        kind: "commission_settlement",
        // Per-position scoping makes the (kind, reference) unique key
        // double as a "did we already settle this position?" gate —
        // a retried resolution will fail the unique index and
        // rollback rather than double-skimming.
        reference: `settlement-fee:${id}:${pos.id}`,
        metadata: {
          marketId: id,
          outcome,
          positionId: pos.id,
          userId: pos.userId,
          gross,
          costBasis: pos.costBasis,
          netPaid: payout,
        },
      });
      totalSettlementFee += fee;
    }

    await tx.position.update({
      where: { id: pos.id },
      data: {
        // Realised PnL = NET payout to the user − their cost basis.
        // For losers (payout=0) this stays negative; for the
        // break-even case (payout=costBasis) it's 0; profitable
        // winners get profit × 0.95 here, matching what was
        // credited to their wallet.
        realizedPnl: payout - pos.costBasis,
      },
    });

    // Achievement checks per holder (first_win, profitable). Pass
    // the GROSS payout so an "earned 1000 coins" milestone still
    // counts pre-rake — the user's actual progress mirrors what they
    // *would have* earned, not what they netted after fees.
    if (!isCancelled) {
      const unlocks = await onResolution(tx, pos.userId, {
        payout: gross,
        costBasis: pos.costBasis,
      });
      if (unlocks.length > 0) unlocksByUser.set(pos.userId, unlocks);
    }

    // Notify the position holder. We surface the NET payout (what
    // they actually received) plus the fee so they know where the
    // delta went.
    await tx.notification.create({
      data: {
        userId: pos.userId,
        title: isCancelled
          ? "Market cancelled — refunded"
          : payout > 0
            ? "You won a market!"
            : "Market resolved",
        body: isCancelled
          ? `“${market.title}” was cancelled. ${payout} coins refunded.`
          : payout > 0
            ? fee > 0
              ? `“${market.title}” resolved ${outcome}. You earned ${payout} coins (after a ${fee}-coin platform fee on profit).`
              : `“${market.title}” resolved ${outcome}. You earned ${payout} coins.`
            : `“${market.title}” resolved ${outcome}. Better luck next time.`,
        href: `/markets/${market.slug}`,
      },
    });
  }

  await tx.market.update({
    where: { id },
    data: {
      status: outcome === "CANCELLED" ? "CANCELLED" : "RESOLVED",
      resolvedAs: outcome === "CANCELLED" ? null : outcome,
      resolvedAt: new Date(),
      resolutionNote: note ?? null,
    },
  });

  // PR-BET-ADMIN-FOLLOWUPS — Settlement audit row.
  //
  // Idempotent upsert keyed on marketId so the same resolution
  // never writes two audit rows even if the route is retried.
  // Populates the /admin/settlements + /admin/payouts surfaces
  // with the canonical "what was paid, to how many users, by
  // whom" summary — distinct from AdminLog (which is "who did
  // what action") because the Settlement row also carries
  // retry state for the payout queue worker.
  const loserCount = positions.length - payoutCount;
  await tx.settlement.upsert({
    where: { marketId: id },
    create: {
      marketId: id,
      outcome,
      totalPayout: paidOut,
      totalFees: totalSettlementFee,
      winnerCount: payoutCount,
      loserCount: Math.max(0, loserCount),
      status: "EXECUTED",
      executedById,
      attempts: 1,
    },
    update: {
      // Retry path — the resolution already ran; re-asserting
      // totals + bumping the attempt counter is enough.
      outcome,
      totalPayout: paidOut,
      totalFees: totalSettlementFee,
      winnerCount: payoutCount,
      loserCount: Math.max(0, loserCount),
      status: "EXECUTED",
      attempts: { increment: 1 },
      lastError: null,
    },
  });

  await tx.adminLog.create({
    data: {
      adminId: executedById,
      action: outcome === "CANCELLED" ? "market.cancel" : "market.resolve",
      targetId: id,
      metadata: {
        outcome,
        payoutCount,
        paidOut,
        settlementFee: totalSettlementFee,
        ordersCancelled: orderRefunds.cancelledCount,
        ordersRefundedCoins: orderRefunds.refundedCoins,
      },
    },
  });

  return {
    payoutCount,
    paidOut,
    settlementFee: totalSettlementFee,
    unlocksByUser,
    orderRefunds,
    market,
  };
}
