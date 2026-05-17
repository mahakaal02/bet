import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";

const Body = z.object({
  adjustBalance: z.number().int().optional(),
  reason: z.string().max(120).optional(),
  banned: z.boolean().optional(),
  isAdmin: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getAuthedUser();
  if (!me?.isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  if (id === me.id && parsed.data.isAdmin === false) {
    return NextResponse.json(
      { error: "cannot_demote_self" },
      { status: 409 },
    );
  }

  await db.$transaction(async (tx) => {
    if (parsed.data.adjustBalance !== undefined && parsed.data.adjustBalance !== 0) {
      await tx.wallet.update({
        where: { userId: id },
        data: { balance: { increment: parsed.data.adjustBalance } },
      });
      await tx.transaction.create({
        data: {
          userId: id,
          delta: parsed.data.adjustBalance,
          kind: "admin_grant",
          reference: `admin:${me.id}:${Date.now()}`,
          metadata: { reason: parsed.data.reason ?? null, by: me.id },
        },
      });
    }
    if (parsed.data.banned !== undefined || parsed.data.isAdmin !== undefined) {
      await tx.user.update({
        where: { id },
        data: {
          ...(parsed.data.banned !== undefined && {
            banned: parsed.data.banned,
          }),
          ...(parsed.data.isAdmin !== undefined && {
            isAdmin: parsed.data.isAdmin,
          }),
        },
      });
    }
    await tx.adminLog.create({
      data: {
        adminId: me.id,
        action: parsed.data.banned
          ? "user.ban"
          : parsed.data.banned === false
            ? "user.unban"
            : parsed.data.isAdmin
              ? "user.grant_admin"
              : parsed.data.isAdmin === false
                ? "user.revoke_admin"
                : "user.adjust_balance",
        targetId: id,
        metadata: parsed.data,
      },
    });
  });

  return NextResponse.json({ ok: true });
}
