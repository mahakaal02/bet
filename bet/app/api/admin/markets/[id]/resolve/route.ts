import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { publishUnlocks } from "@/lib/achievements";
import { publish, Channels } from "@/lib/pubsub";
import { logger } from "@/lib/logger";
import { resolveMarketTx, HttpError } from "@/lib/settlement";
import { logApiCall, getIp } from "@/lib/api-log";

const Body = z.object({
  outcome: z.enum(["YES", "NO", "CANCELLED"]),
  note: z.string().max(500).optional(),
});

/**
 * Atomic market resolution. For YES/NO: every position on the winning side
 * is paid out 1 coin per share. For CANCELLED: all positions are refunded
 * their costBasis. All-or-nothing — Postgres rollback on any failure leaves
 * the market OPEN.
 *
 * The settlement transaction body lives in `lib/settlement.ts`
 * (`resolveMarketTx`) so the group-resolve orchestrator can reuse the exact
 * same logic per child. This route owns auth, request logging, and the
 * post-commit pubsub fan-out.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  // PR-BET-ADMIN-FOLLOWUPS — request timing for the ApiLog writer.
  // Recorded at the end of the handler regardless of success/failure.
  const t0 = Date.now();
  let responseStatus = 200;
  let errorCode: string | null = null;
  const u = await getAuthedUser();
  if (!u?.isAdmin) {
    responseStatus = 403;
    errorCode = "forbidden";
    void logApiCall({
      method: "POST",
      path: "/api/admin/markets/[id]/resolve",
      status: responseStatus,
      durationMs: Date.now() - t0,
      userId: u?.id ?? null,
      ip: getIp(req),
      userAgent: req.headers.get("user-agent"),
      errorCode,
    });
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    responseStatus = 400;
    errorCode = "invalid_input";
    void logApiCall({
      method: "POST",
      path: "/api/admin/markets/[id]/resolve",
      status: responseStatus,
      durationMs: Date.now() - t0,
      userId: u.id,
      ip: getIp(req),
      userAgent: req.headers.get("user-agent"),
      errorCode,
    });
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  try {
    const result = await db.$transaction(
      (tx) =>
        resolveMarketTx(tx, {
          marketId: id,
          outcome: parsed.data.outcome,
          note: parsed.data.note,
          executedById: u.id,
        }),
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

    void logApiCall({
      method: "POST",
      path: "/api/admin/markets/[id]/resolve",
      status: responseStatus,
      durationMs: Date.now() - t0,
      userId: u.id,
      ip: getIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    return NextResponse.json({
      ok: true,
      payoutCount: result.payoutCount,
      paidOut: result.paidOut,
      settlementFee: result.settlementFee,
      ordersCancelled: result.orderRefunds.cancelledCount,
      ordersRefundedCoins: result.orderRefunds.refundedCoins,
    });
  } catch (e) {
    if (e instanceof HttpError) {
      responseStatus = e.status;
      errorCode = e.message;
      void logApiCall({
        method: "POST",
        path: "/api/admin/markets/[id]/resolve",
        status: responseStatus,
        durationMs: Date.now() - t0,
        userId: u.id,
        ip: getIp(req),
        userAgent: req.headers.get("user-agent"),
        errorCode,
      });
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    responseStatus = 500;
    errorCode = "internal";
    logger.error(e, { route: "/api/admin/markets/[id]/resolve", adminId: u.id, marketId: id });
    void logApiCall({
      method: "POST",
      path: "/api/admin/markets/[id]/resolve",
      status: responseStatus,
      durationMs: Date.now() - t0,
      userId: u.id,
      ip: getIp(req),
      userAgent: req.headers.get("user-agent"),
      errorCode,
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
