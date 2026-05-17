import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { onResolution, publishUnlocks } from "@/lib/achievements";
import { publish, Channels } from "@/lib/pubsub";
import { logger } from "@/lib/logger";
import { splitSettlement } from "@/lib/commission";
import { collectFee } from "@/lib/house";

const Body = z.object({
  outcome: z.enum(["YES", "NO", "CANCELLED"]),
  note: z.string().max(500).optional(),
});

/**
 * Atomic market resolution. For YES/NO: every position on the winning side
 * is paid out 1 coin per share. For CANCELLED: all positions are refunded
 * their costBasis. All-or-nothing — Postgres rollback on any failure leaves
 * the market OPEN.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const u = await getAuthedUser();
  if (!u?.isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  try {
    const result = await db.$transaction(
      async (tx) => {
        const market = await tx.market.findUnique({ where: { id } });
        if (!market) throw new HttpError(404, "not_found");
        if (market.status === "RESOLVED" || market.status === "CANCELLED") {
          throw new HttpError(409, "already_resolved");
        }

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
        const isCancelled = parsed.data.outcome === "CANCELLED";

        for (const pos of positions) {
          let gross = 0;
          if (isCancelled) {
            gross = pos.costBasis;
          } else if (pos.outcome === parsed.data.outcome) {
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
                reference: `${parsed.data.outcome}:${id}:${pos.id}`,
                metadata: {
                  marketId: id,
                  outcome: parsed.data.outcome,
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
                outcome: parsed.data.outcome,
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
                    ? `“${market.title}” resolved ${parsed.data.outcome}. You earned ${payout} coins (after a ${fee}-coin platform fee on profit).`
                    : `“${market.title}” resolved ${parsed.data.outcome}. You earned ${payout} coins.`
                  : `“${market.title}” resolved ${parsed.data.outcome}. Better luck next time.`,
              href: `/markets/${market.slug}`,
            },
          });
        }

        await tx.market.update({
          where: { id },
          data: {
            status: parsed.data.outcome === "CANCELLED" ? "CANCELLED" : "RESOLVED",
            resolvedAs:
              parsed.data.outcome === "CANCELLED"
                ? null
                : parsed.data.outcome,
            resolvedAt: new Date(),
            resolutionNote: parsed.data.note ?? null,
          },
        });

        await tx.adminLog.create({
          data: {
            adminId: u.id,
            action:
              parsed.data.outcome === "CANCELLED"
                ? "market.cancel"
                : "market.resolve",
            targetId: id,
            metadata: {
              outcome: parsed.data.outcome,
              payoutCount,
              paidOut,
              settlementFee: totalSettlementFee,
            },
          },
        });

        return {
          payoutCount,
          paidOut,
          settlementFee: totalSettlementFee,
          unlocksByUser,
          market,
        };
      },
      { timeout: 30_000 },
    );

    // Post-commit fan-out. Tell every market subscriber the final price (1
    // for the winning side, 0 for the loser, 0.5 for cancelled), and ping
    // each affected user's channel for their notifications + any unlocks.
    const finalYes =
      parsed.data.outcome === "YES"
        ? 1
        : parsed.data.outcome === "NO"
          ? 0
          : 0.5;
    publish(Channels.market(result.market.id), {
      type: "resolved",
      outcome: parsed.data.outcome,
      yesPrice: finalYes,
      noPrice: 1 - finalYes,
      at: Date.now(),
    });
    for (const [userId, unlocks] of result.unlocksByUser) {
      publishUnlocks(userId, unlocks);
      publish(Channels.user(userId), {
        type: "notification",
        at: Date.now(),
      });
    }

    return NextResponse.json({
      ok: true,
      payoutCount: result.payoutCount,
      paidOut: result.paidOut,
      settlementFee: result.settlementFee,
    });
  } catch (e) {
    if (e instanceof HttpError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    logger.error(e, { route: "/api/admin/markets/[id]/resolve", adminId: u.id, marketId: id });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
