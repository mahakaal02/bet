import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { publishUnlocks } from "@/lib/achievements";
import { publish, Channels } from "@/lib/pubsub";
import { logger } from "@/lib/logger";
import { resolveMarketTx, HttpError } from "@/lib/settlement";
import { logApiCall, getIp } from "@/lib/api-log";

/**
 * Group settlement orchestration (Phase 2 — EXCLUSIVE groups only).
 *
 * Two shapes:
 *   { winnerMarketId, note? }   → winner child resolves YES, the rest NO
 *   { outcome: "CANCELLED", note? } → every child is cancelled (refunded)
 *
 * Each child settles in its OWN `db.$transaction` via the shared
 * `resolveMarketTx` — the exact same logic the standalone resolve route
 * runs — so per-child atomicity matches today's behaviour and we avoid one
 * giant transaction that could time out or hold locks across many markets.
 *
 * The endpoint is **safely retryable**: a child that's already resolved
 * throws 409 inside its tx, which we treat as "skip" (not a failure). Only
 * when every child resolved or skipped cleanly do we flip the group to
 * RESOLVED/CANCELLED. If any child errors for another reason we leave the
 * group un-flipped and return 500 with a per-child report so the admin can
 * re-POST after fixing the cause.
 */
const Body = z
  .object({
    winnerMarketId: z.string().min(1).optional(),
    outcome: z.literal("CANCELLED").optional(),
    note: z.string().max(500).optional(),
  })
  .refine(
    (d) => (d.outcome === "CANCELLED") !== Boolean(d.winnerMarketId),
    "Provide exactly one of winnerMarketId or outcome:CANCELLED.",
  );

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const t0 = Date.now();
  const log = (status: number, userId: string | null, errorCode?: string) =>
    void logApiCall({
      method: "POST",
      path: "/api/admin/market-groups/[id]/resolve",
      status,
      durationMs: Date.now() - t0,
      userId,
      ip: getIp(req),
      userAgent: req.headers.get("user-agent"),
      errorCode: errorCode ?? null,
    });

  const u = await getAuthedUser();
  if (!u?.isAdmin) {
    log(403, u?.id ?? null, "forbidden");
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    log(400, u.id, "invalid_input");
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const { winnerMarketId, note } = parsed.data;
  const isCancel = parsed.data.outcome === "CANCELLED";

  const group = await db.marketGroup.findUnique({
    where: { id },
    include: { markets: { select: { id: true }, orderBy: { groupSortOrder: "asc" } } },
  });
  if (!group) {
    log(404, u.id, "not_found");
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (group.type !== "EXCLUSIVE") {
    // INDEPENDENT events have no coupled outcome — resolve their children
    // individually via the per-market resolve route instead.
    log(400, u.id, "not_exclusive");
    return NextResponse.json({ error: "not_exclusive" }, { status: 400 });
  }
  if (group.status === "RESOLVED" || group.status === "CANCELLED") {
    log(409, u.id, "already_resolved");
    return NextResponse.json({ error: "already_resolved" }, { status: 409 });
  }
  if (!isCancel && !group.markets.some((m) => m.id === winnerMarketId)) {
    log(400, u.id, "invalid_winner");
    return NextResponse.json({ error: "invalid_winner" }, { status: 400 });
  }

  // ── Settle each child in its own transaction, fanning out post-commit. ──
  const resolved: string[] = [];
  const skipped: string[] = [];
  const failed: { marketId: string; error: string }[] = [];

  for (const child of group.markets) {
    const childOutcome: "YES" | "NO" | "CANCELLED" = isCancel
      ? "CANCELLED"
      : child.id === winnerMarketId
        ? "YES"
        : "NO";
    try {
      const result = await db.$transaction(
        (tx) =>
          resolveMarketTx(tx, {
            marketId: child.id,
            outcome: childOutcome,
            note,
            executedById: u.id,
          }),
        { timeout: 30_000 },
      );
      resolved.push(child.id);

      // Post-commit fan-out for this child — same payload shape the
      // standalone resolve route publishes, so the child SSE stream and
      // the event page's per-child EventSources both update + re-rank.
      const finalYes = childOutcome === "YES" ? 1 : childOutcome === "NO" ? 0 : 0.5;
      publish(Channels.market(result.market.id), {
        type: "resolved",
        outcome: childOutcome,
        yesPrice: finalYes,
        noPrice: 1 - finalYes,
        at: Date.now(),
      });
      for (const [userId, unlocks] of result.unlocksByUser) {
        publishUnlocks(userId, unlocks);
        publish(Channels.user(userId), { type: "notification", at: Date.now() });
      }
    } catch (e) {
      // Already-resolved children are the retry path — skip, don't fail.
      if (e instanceof HttpError && e.status === 409) {
        skipped.push(child.id);
        continue;
      }
      logger.error(e, {
        route: "/api/admin/market-groups/[id]/resolve",
        adminId: u.id,
        groupId: id,
        childId: child.id,
      });
      failed.push({
        marketId: child.id,
        error: e instanceof HttpError ? e.message : "internal",
      });
    }
  }

  // Any non-409 failure leaves the group un-flipped so a re-POST can finish
  // the job (resolved/skipped children are idempotent on the retry).
  if (failed.length > 0) {
    log(500, u.id, "partial_failure");
    return NextResponse.json(
      {
        error: "partial_failure",
        resolved: resolved.length,
        skipped: skipped.length,
        failed,
      },
      { status: 500 },
    );
  }

  // All children settled (or were already settled). Flip the group + audit.
  await db.$transaction(async (tx) => {
    await tx.marketGroup.update({
      where: { id },
      data: {
        status: isCancel ? "CANCELLED" : "RESOLVED",
        resolvedWinnerMarketId: isCancel ? null : winnerMarketId,
        resolvedAt: new Date(),
        resolutionNote: note ?? null,
      },
    });
    await tx.adminLog.create({
      data: {
        adminId: u.id,
        action: isCancel ? "group.cancel" : "group.resolve",
        targetId: id,
        metadata: {
          winnerMarketId: winnerMarketId ?? null,
          childCount: group.markets.length,
          resolved: resolved.length,
          skipped: skipped.length,
        },
      },
    });
  });

  log(200, u.id);
  return NextResponse.json({
    ok: true,
    resolved: resolved.length,
    skipped: skipped.length,
    childCount: group.markets.length,
  });
}
