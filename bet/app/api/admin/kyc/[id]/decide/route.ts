import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, RbacError } from "@/lib/rbac";

/**
 * POST /api/admin/kyc/[id]/decide (PR-BET-ADMIN-FOLLOWUPS).
 * Body: { decision: 'APPROVED' | 'REJECTED' | 'REQUEST_MORE', rejectionCode?, notes? }
 *
 * Admin decision on a KYC submission. Writes the decision back,
 * sends an in-app notification to the user, and writes an admin-log
 * audit row.
 */
const VALID = new Set(["APPROVED", "REJECTED", "REQUEST_MORE"]);

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const me = await requireAdmin();
    const { id } = await context.params;
    const body = (await req.json().catch(() => ({}))) as {
      decision?: string;
      rejectionCode?: string;
      notes?: string;
    };
    if (!body.decision || !VALID.has(body.decision)) {
      return NextResponse.json(
        { error: "decision must be APPROVED, REJECTED, or REQUEST_MORE" },
        { status: 400 },
      );
    }
    const submission = await db.kycSubmission.findUnique({ where: { id } });
    if (!submission) {
      return NextResponse.json({ error: "submission not found" }, { status: 404 });
    }
    if (submission.status !== "PENDING") {
      return NextResponse.json(
        { error: `submission is in '${submission.status}' state, not PENDING` },
        { status: 409 },
      );
    }

    const updated = await db.kycSubmission.update({
      where: { id },
      data: {
        status: body.decision,
        rejectionCode:
          body.decision === "REJECTED" ? body.rejectionCode ?? "UNSPECIFIED" : null,
        notes: body.notes ?? null,
        reviewedById: me.id,
        reviewedAt: new Date(),
      },
    });

    // Notify the user.
    await db.notification.create({
      data: {
        userId: submission.userId,
        title:
          body.decision === "APPROVED"
            ? "Identity verified"
            : body.decision === "REJECTED"
              ? "Identity verification rejected"
              : "More information requested",
        body:
          body.decision === "APPROVED"
            ? "Your KYC was approved. Full withdrawal limits are now active."
            : body.decision === "REJECTED"
              ? `Your KYC was rejected${body.rejectionCode ? ` (${body.rejectionCode})` : ""}. ${body.notes ?? "You can resubmit on the /kyc page."}`
              : `${body.notes ?? "Please resubmit with the additional documents requested."}`,
        href: "/kyc",
      },
    });

    await db.adminLog.create({
      data: {
        adminId: me.id,
        action: `kyc.${body.decision.toLowerCase()}`,
        targetId: id,
        metadata: { userId: submission.userId, rejectionCode: body.rejectionCode ?? null },
      },
    });

    return NextResponse.json({ ok: true, status: updated.status });
  } catch (e) {
    if (e instanceof RbacError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
