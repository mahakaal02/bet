import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { redeemAdminInvite, RbacError } from "@/lib/rbac";

/**
 * POST /api/admin/invites/redeem
 * Body: { token }
 *
 * PR-BET-ADMIN-REDESIGN. Accept an admin invite. Caller must be
 * authed and their email must match the invite's email.
 */
export async function POST(req: Request) {
  try {
    const me = await getAuthedUser();
    if (!me) {
      return NextResponse.json({ error: "sign in required" }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as { token?: string };
    if (!body.token) {
      return NextResponse.json({ error: "token required" }, { status: 400 });
    }
    const invite = await redeemAdminInvite(body.token, me.id);
    await db.adminLog.create({
      data: {
        adminId: me.id,
        action: "admin.invite.accept",
        targetId: invite.id,
        metadata: { email: invite.email },
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
