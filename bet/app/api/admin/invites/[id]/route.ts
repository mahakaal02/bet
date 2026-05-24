import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin, RbacError } from "@/lib/rbac";

/**
 * DELETE /api/admin/invites/[id] — revoke a pending invite.
 *
 * PR-BET-ADMIN-REDESIGN. Super-admin only. Sets `revokedAt` rather
 * than hard-deleting so the audit trail survives.
 */
export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const me = await requireSuperAdmin();
    const { id } = await context.params;
    const invite = await db.adminInvite.findUnique({ where: { id } });
    if (!invite) {
      return NextResponse.json({ error: "invite not found" }, { status: 404 });
    }
    if (invite.acceptedAt) {
      return NextResponse.json(
        { error: "invite already accepted; demote the user via /admin/admins/[id] instead" },
        { status: 409 },
      );
    }
    await db.adminInvite.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await db.adminLog.create({
      data: {
        adminId: me.id,
        action: "admin.invite.revoke",
        targetId: id,
        metadata: { email: invite.email },
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof RbacError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
