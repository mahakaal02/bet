import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { logger } from "@/lib/logger";

const Body = z.object({
  action: z.enum(["approve", "reject", "mark_paid"]),
  note: z.string().max(280).optional(),
  /** Razorpay payout id, captured when marking paid. */
  paidReference: z.string().max(120).optional(),
});

/**
 * Admin decision endpoint for a withdrawal:
 *
 *   approve   PENDING  → APPROVED
 *   reject    PENDING  → REJECTED  (refunds coins to the user)
 *   mark_paid APPROVED → PAID      (records payout reference)
 *
 * Each action is atomic with its compensating wallet move (for reject) and
 * audit row. AdminLog captures who did what and when, including a snapshot
 * of the user's payout method for the audit trail.
 *
 * Approve is intentionally separate from mark_paid so an admin can queue
 * payouts in bulk inside Razorpay's payouts dashboard, then come back and
 * tick each one as paid with the resulting reference.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getAuthedUser();
  if (!me?.isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const { action, note, paidReference } = parsed.data;

  try {
    const result = await db.$transaction(async (tx) => {
      const w = await tx.withdrawalRequest.findUnique({ where: { id } });
      if (!w) return { ok: false as const, error: "not_found", status: 404 };

      // State machine — only specific transitions are valid.
      const valid =
        (action === "approve" && w.status === "PENDING") ||
        (action === "reject" && w.status === "PENDING") ||
        (action === "mark_paid" && w.status === "APPROVED");
      if (!valid) {
        return { ok: false as const, error: "invalid_state", status: 409 };
      }

      if (action === "approve") {
        await tx.withdrawalRequest.update({
          where: { id },
          data: {
            status: "APPROVED",
            decisionNote: note ?? null,
            decidedById: me.id,
            decidedAt: new Date(),
          },
        });
      }

      if (action === "reject") {
        // Refund the locked coins.
        await tx.wallet.update({
          where: { userId: w.userId },
          data: { balance: { increment: w.amountCoins } },
        });
        await tx.transaction.create({
          data: {
            userId: w.userId,
            delta: w.amountCoins,
            kind: "withdrawal_refund",
            reference: `withdrawal:${w.id}:reject`,
            metadata: {
              withdrawalId: w.id,
              decidedBy: me.id,
              reason: note ?? "admin_rejected",
            },
          },
        });
        await tx.withdrawalRequest.update({
          where: { id },
          data: {
            status: "REJECTED",
            decisionNote: note ?? null,
            decidedById: me.id,
            decidedAt: new Date(),
          },
        });
        await tx.notification.create({
          data: {
            userId: w.userId,
            title: "Withdrawal rejected",
            body: `Your ₹${w.amountCoins} request was rejected. Coins refunded.${note ? ` Reason: ${note}` : ""}`,
            href: "/wallet",
          },
        });
      }

      if (action === "mark_paid") {
        if (!paidReference) {
          return {
            ok: false as const,
            error: "missing_paid_reference",
            status: 400,
          };
        }
        await tx.withdrawalRequest.update({
          where: { id },
          data: {
            status: "PAID",
            paidReference,
            paidAt: new Date(),
            // Note may carry the Razorpay transaction id detail; keep it.
            decisionNote: note ?? w.decisionNote,
          },
        });
        await tx.notification.create({
          data: {
            userId: w.userId,
            title: "Withdrawal paid",
            body: `₹${w.amountCoins} sent — reference ${paidReference}.`,
            href: "/wallet",
          },
        });
      }

      await tx.adminLog.create({
        data: {
          adminId: me.id,
          action: `withdrawal.${action}`,
          targetId: id,
          metadata: {
            amountCoins: w.amountCoins,
            payoutMethod: w.payoutMethod,
            userId: w.userId,
            note: note ?? null,
            paidReference: paidReference ?? null,
          },
        },
      });

      return { ok: true as const };
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    logger.error(e, {
      route: "/api/admin/withdrawals/[id]",
      adminId: me.id,
      withdrawalId: id,
      action,
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
