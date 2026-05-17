import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const Body = z.object({
  targetType: z.enum(["COMMENT", "MARKET"]),
  targetId: z.string().min(1).max(50),
  reason: z.string().min(3).max(280),
});

/**
 * File a content report. Idempotent on (reporterId, targetType, targetId,
 * status=PENDING) so a double-click doesn't queue twice.
 *
 *   POST /api/reports
 *   { targetType: "COMMENT", targetId: "...", reason: "spam" }
 */
export async function POST(req: Request) {
  const u = await getAuthedUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Aggressive limit — a single user can only file ~5 reports per hour. The
  // admin queue is fragile if any one user can flood it.
  const limit = rateLimit(`report:${u.id}`, { limit: 5, windowMs: 60 * 60_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const { targetType, targetId, reason } = parsed.data;

  // Validate the target actually exists before queueing — keeps the queue
  // clean of obvious garbage (deleted comments, made-up IDs).
  if (targetType === "COMMENT") {
    const c = await db.comment.findUnique({
      where: { id: targetId },
      select: { id: true, userId: true },
    });
    if (!c) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (c.userId === u.id) {
      return NextResponse.json({ error: "self_report" }, { status: 400 });
    }
  } else if (targetType === "MARKET") {
    const m = await db.market.findUnique({
      where: { id: targetId },
      select: { id: true },
    });
    if (!m) return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const row = await db.report.create({
      data: {
        reporterId: u.id,
        targetType,
        targetId,
        reason: reason.trim(),
      },
    });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (e) {
    // Unique constraint trip: this user already has a PENDING report on
    // this target. Treat as success — the goal is "I've flagged it".
    if (
      typeof (e as { code?: string }).code === "string" &&
      (e as { code: string }).code === "P2002"
    ) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    logger.error(e, { route: "/api/reports", userId: u.id, targetType, targetId });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
