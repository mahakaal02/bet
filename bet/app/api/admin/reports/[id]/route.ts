import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { logger } from "@/lib/logger";

const Body = z.object({
  action: z.enum(["resolve", "dismiss"]),
  note: z.string().max(280).optional(),
  /** Only relevant for `action=resolve`: also hide the targeted comment. */
  hideTarget: z.boolean().optional(),
});

/**
 * Resolve or dismiss a report. Side-effects:
 *
 *   - `resolve` + hideTarget=true (the typical case): flip the comment's
 *      `hidden` flag so it disappears from /api/markets/[id]/comments.
 *   - `dismiss`: no content change; report rows tracks the decision for
 *      audit.
 *
 * Resolving / dismissing the same report twice is idempotent — second call
 * is rejected with `already_resolved` so the admin sees what happened.
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
    const result = await db.$transaction(async (tx) => {
      const report = await tx.report.findUnique({ where: { id } });
      if (!report) return { ok: false as const, error: "not_found", status: 404 };
      if (report.status !== "PENDING") {
        return { ok: false as const, error: "already_resolved", status: 409 };
      }

      await tx.report.update({
        where: { id },
        data: {
          status: parsed.data.action === "resolve" ? "RESOLVED" : "DISMISSED",
          resolverId: u.id,
          resolverNote: parsed.data.note ?? null,
          resolvedAt: new Date(),
        },
      });

      // If the admin chose to hide the target comment, flip the flag. Other
      // pending reports on the same comment also flip to RESOLVED so the
      // queue doesn't keep showing duplicates after one decisive action.
      if (
        parsed.data.action === "resolve" &&
        parsed.data.hideTarget &&
        report.targetType === "COMMENT"
      ) {
        await tx.comment.update({
          where: { id: report.targetId },
          data: { hidden: true },
        });
        await tx.report.updateMany({
          where: {
            targetType: "COMMENT",
            targetId: report.targetId,
            status: "PENDING",
            id: { not: report.id },
          },
          data: {
            status: "RESOLVED",
            resolverId: u.id,
            resolverNote: "Auto-resolved with primary report",
            resolvedAt: new Date(),
          },
        });
      }

      await tx.adminLog.create({
        data: {
          adminId: u.id,
          action: `report.${parsed.data.action}`,
          targetId: report.id,
          metadata: {
            targetType: report.targetType,
            targetId: report.targetId,
            hideTarget: !!parsed.data.hideTarget,
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
    logger.error(e, { route: "/api/admin/reports/[id]", adminId: u.id, reportId: id });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
