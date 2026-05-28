import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";

const Body = z
  .object({
    title: z.string().min(3).max(140),
    description: z.string().max(2000).nullish().or(z.literal("")),
    category: z.enum(["POLITICS", "SPORTS", "CRYPTO", "TECH", "ENTERTAINMENT"]),
    type: z.enum(["EXCLUSIVE", "INDEPENDENT"]),
    status: z.enum(["OPEN", "CLOSED"]),
    featured: z.boolean(),
    sortOrder: z.number().int().min(0).max(100_000),
  })
  .partial();

/**
 * Edit an event/group's metadata (admin only). Like the market edit route,
 * a RESOLVED/CANCELLED group is frozen (`cannot_edit_resolved`) — settlement
 * is final. `status` here only toggles OPEN/CLOSED (display gating);
 * RESOLVED/CANCELLED are set exclusively by the resolve endpoint (Phase 2),
 * never by a plain edit.
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

  const existing = await db.marketGroup.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (existing.status === "RESOLVED" || existing.status === "CANCELLED") {
    return NextResponse.json({ error: "cannot_edit_resolved" }, { status: 409 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const updated = await db.marketGroup.update({
    where: { id },
    data: {
      ...(parsed.data.title !== undefined && { title: parsed.data.title }),
      ...(parsed.data.description !== undefined && {
        description: parsed.data.description || null,
      }),
      ...(parsed.data.category !== undefined && { category: parsed.data.category }),
      ...(parsed.data.type !== undefined && { type: parsed.data.type }),
      ...(parsed.data.status !== undefined && { status: parsed.data.status }),
      ...(parsed.data.featured !== undefined && { featured: parsed.data.featured }),
      ...(parsed.data.sortOrder !== undefined && { sortOrder: parsed.data.sortOrder }),
    },
  });

  await db.adminLog.create({
    data: {
      adminId: u.id,
      action: "group.update",
      targetId: id,
      metadata: { changes: parsed.data },
    },
  });

  return NextResponse.json({ ok: true, slug: updated.slug });
}
