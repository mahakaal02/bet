import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { logger } from "@/lib/logger";

const Body = z.object({ hidden: z.boolean() });

/**
 * Admin-only toggle for `Comment.hidden`. Used both from the dedicated
 * /admin/comments page and as the "unhide" fallback for the reports queue.
 * Audited into AdminLog with the new flag value so a moderator's pattern
 * is reviewable.
 */
export async function PATCH(
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
    const updated = await db.comment.update({
      where: { id },
      data: { hidden: parsed.data.hidden },
      select: { id: true, hidden: true, marketId: true },
    });
    await db.adminLog.create({
      data: {
        adminId: u.id,
        action: parsed.data.hidden ? "comment.hide" : "comment.unhide",
        targetId: id,
        metadata: { marketId: updated.marketId },
      },
    });
    return NextResponse.json({ ok: true, hidden: updated.hidden });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2025") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    logger.error(e, { route: "/api/admin/comments/[id]", adminId: u.id, commentId: id });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
