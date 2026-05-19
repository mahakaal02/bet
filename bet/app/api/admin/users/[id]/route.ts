import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";

/**
 * Admin user-moderation patch. Permitted actions:
 *
 *   - `adjustBalance` + `reason` — credit/debit coins with audit row.
 *   - `banned`                  — toggle the user's ban flag.
 *
 * `isAdmin` is INTENTIONALLY not editable. Only one admin exists, set
 * by the database seed (admin@kalki.local). Allowing it to flow
 * through this endpoint risks accidental promotion via a misclick on
 * the moderation panel, and the product spec is "one admin, ever".
 * Sub-admins with scoped permissions will be added as a separate
 * role/permission system later, not by reusing this boolean.
 */
const Body = z.object({
  adjustBalance: z.number().int().optional(),
  reason: z.string().max(120).optional(),
  banned: z.boolean().optional(),
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
    if (parsed.data.banned !== undefined) {
      await tx.user.update({
        where: { id },
        data: { banned: parsed.data.banned },
      });
    }
    await tx.adminLog.create({
      data: {
        adminId: me.id,
        action:
          parsed.data.banned === true
            ? "user.ban"
            : parsed.data.banned === false
              ? "user.unban"
              : "user.adjust_balance",
        targetId: id,
        metadata: parsed.data,
      },
    });
  });

  return NextResponse.json({ ok: true });
}
