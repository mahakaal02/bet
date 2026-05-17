import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { logger } from "@/lib/logger";

/**
 * Cancel a still-PENDING withdrawal. Refunds the locked coins via a
 * compensating credit; the audit ledger keeps both entries so the net
 * effect is zero but every operation is traceable.
 *
 * Once an admin has marked the request APPROVED / REJECTED / PAID, the
 * user can no longer cancel — the admin owns the decision.
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const u = await getAuthedUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  try {
    const result = await db.$transaction(async (tx) => {
      const w = await tx.withdrawalRequest.findUnique({ where: { id } });
      if (!w) return { ok: false as const, error: "not_found", status: 404 };
      if (w.userId !== u.id) {
        return { ok: false as const, error: "forbidden", status: 403 };
      }
      if (w.status !== "PENDING") {
        return { ok: false as const, error: "not_cancellable", status: 409 };
      }

      // Refund: compensating credit with the SAME reference suffixed so
      // the audit row pair (lock, refund) is greppable.
      await tx.wallet.update({
        where: { userId: u.id },
        data: { balance: { increment: w.amountCoins } },
      });
      await tx.transaction.create({
        data: {
          userId: u.id,
          delta: w.amountCoins,
          kind: "withdrawal_refund",
          reference: `withdrawal:${w.id}:cancel`,
          metadata: { withdrawalId: w.id, reason: "user_cancelled" },
        },
      });
      await tx.withdrawalRequest.update({
        where: { id },
        data: { status: "CANCELLED", decidedAt: new Date() },
      });
      return { ok: true as const };
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    logger.error(e, {
      route: "/api/wallet/withdraw/[id]",
      userId: u.id,
      id,
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
