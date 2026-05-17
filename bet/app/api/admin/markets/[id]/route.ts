import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";

const Body = z
  .object({
    title: z.string().min(3).max(140),
    description: z.string().min(1).max(2000),
    bannerUrl: z.string().url().nullish().or(z.literal("")),
    category: z.enum(["POLITICS", "SPORTS", "CRYPTO", "TECH", "ENTERTAINMENT"]),
    resolutionSource: z.string().max(500).nullish().or(z.literal("")),
    endsAt: z.string().datetime(),
    featured: z.boolean().optional(),
  })
  .partial();

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const u = await getAuthedUser();
  if (!u?.isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;

  const existing = await db.market.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (existing.status === "RESOLVED" || existing.status === "CANCELLED") {
    return NextResponse.json(
      { error: "cannot_edit_resolved" },
      { status: 409 },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const updated = await db.market.update({
    where: { id },
    data: {
      ...(parsed.data.title !== undefined && { title: parsed.data.title }),
      ...(parsed.data.description !== undefined && {
        description: parsed.data.description,
      }),
      ...(parsed.data.bannerUrl !== undefined && {
        bannerUrl: parsed.data.bannerUrl || null,
      }),
      ...(parsed.data.category !== undefined && {
        category: parsed.data.category,
      }),
      ...(parsed.data.resolutionSource !== undefined && {
        resolutionSource: parsed.data.resolutionSource || null,
      }),
      ...(parsed.data.endsAt !== undefined && {
        endsAt: new Date(parsed.data.endsAt),
      }),
      ...(parsed.data.featured !== undefined && {
        featured: parsed.data.featured,
      }),
    },
  });

  await db.adminLog.create({
    data: {
      adminId: u.id,
      action: "market.update",
      targetId: id,
      metadata: { changes: parsed.data },
    },
  });

  return NextResponse.json({ ok: true, slug: updated.slug });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const u = await getAuthedUser();
  if (!u?.isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  // FK cascades remove trades, positions, comments, watchlist, price points.
  await db.market.delete({ where: { id } }).catch(() => undefined);
  await db.adminLog.create({
    data: { adminId: u.id, action: "market.delete", targetId: id },
  });
  return NextResponse.json({ ok: true });
}
