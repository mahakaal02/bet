import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";

const Body = z.object({
  title: z.string().min(3).max(140),
  description: z.string().max(2000).nullish().or(z.literal("")),
  category: z.enum(["POLITICS", "SPORTS", "CRYPTO", "TECH", "ENTERTAINMENT"]),
  type: z.enum(["EXCLUSIVE", "INDEPENDENT"]).optional(),
  featured: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});

/**
 * Create an event/group (admin only). Purely additive: a group is metadata
 * that ties existing binary markets together for display/ranking. Markets are
 * attached afterwards by editing each market (PATCH /api/admin/markets/[id]
 * with groupId), so this endpoint never touches a Market or its money.
 */
export async function POST(req: Request) {
  const u = await getAuthedUser();
  if (!u?.isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const slug = await uniqueSlug(parsed.data.title);
  const group = await db.marketGroup.create({
    data: {
      slug,
      title: parsed.data.title,
      description: parsed.data.description || null,
      category: parsed.data.category,
      type: parsed.data.type ?? "EXCLUSIVE",
      featured: parsed.data.featured ?? false,
      sortOrder: parsed.data.sortOrder ?? 0,
      createdById: u.id,
    },
  });
  await db.adminLog.create({
    data: {
      adminId: u.id,
      action: "group.create",
      targetId: group.id,
      metadata: { title: group.title, type: group.type },
    },
  });

  return NextResponse.json({ ok: true, id: group.id, slug: group.slug });
}

async function uniqueSlug(title: string): Promise<string> {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "event";
  let slug = base;
  let i = 1;
  while (await db.marketGroup.findUnique({ where: { slug } })) {
    slug = `${base}-${i++}`;
  }
  return slug;
}
