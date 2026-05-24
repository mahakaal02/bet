import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin, setAdminRole, RbacError } from "@/lib/rbac";

/**
 * DELETE /api/admin/admins/[id] — demote a staff admin to regular user.
 *
 * PR-BET-ADMIN-REDESIGN. Super-admin only. The super admin themselves
 * cannot be demoted via this UI — `setAdminRole` throws `super_admin_immutable`.
 */
export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const me = await requireSuperAdmin();
    const { id } = await context.params;
    await setAdminRole(id, null);
    await db.adminLog.create({
      data: {
        adminId: me.id,
        action: "admin.role.revoke",
        targetId: id,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof RbacError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
