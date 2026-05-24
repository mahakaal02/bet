import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createAdminInvite, requireSuperAdmin, RbacError } from "@/lib/rbac";

/**
 * POST /api/admin/invites — create an admin invite (super-admin only).
 * GET  /api/admin/invites — list pending invites (super-admin only).
 *
 * PR-BET-ADMIN-REDESIGN.
 */

export async function POST(req: Request) {
  try {
    const me = await requireSuperAdmin();
    const body = (await req.json().catch(() => ({}))) as {
      email?: string;
      username?: string;
    };
    if (!body.email || !body.username) {
      return NextResponse.json(
        { error: "email and username are required" },
        { status: 400 },
      );
    }
    const invite = await createAdminInvite({
      email: body.email,
      username: body.username,
      invitedById: me.id,
    });
    await db.adminLog.create({
      data: {
        adminId: me.id,
        action: "admin.invite.create",
        targetId: invite.id,
        metadata: { email: invite.email, username: invite.username },
      },
    });
    return NextResponse.json({
      id: invite.id,
      token: invite.token,
      email: invite.email,
      username: invite.username,
      expiresAt: invite.expiresAt.toISOString(),
    });
  } catch (e) {
    if (e instanceof RbacError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function GET() {
  try {
    await requireSuperAdmin();
    const rows = await db.adminInvite.findMany({
      where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(rows);
  } catch (e) {
    if (e instanceof RbacError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
