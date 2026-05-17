import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";

const Body = z.object({
  title: z.string().min(3).max(140),
  description: z.string().min(1).max(2000),
  bannerUrl: z.string().url().nullish().or(z.literal("")),
  category: z.enum(["POLITICS", "SPORTS", "CRYPTO", "TECH", "ENTERTAINMENT"]),
  resolutionSource: z.string().max(500).nullish().or(z.literal("")),
  endsAt: z.string().datetime(),
  featured: z.boolean().optional(),
});

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
  const market = await db.market.create({
    data: {
      slug,
      title: parsed.data.title,
      description: parsed.data.description,
      bannerUrl: parsed.data.bannerUrl || null,
      category: parsed.data.category,
      resolutionSource: parsed.data.resolutionSource || null,
      endsAt: new Date(parsed.data.endsAt),
      featured: parsed.data.featured ?? false,
      createdById: u.id,
      pricePoints: { create: { yesPrice: 0.5, noPrice: 0.5 } },
    },
  });
  await db.adminLog.create({
    data: {
      adminId: u.id,
      action: "market.create",
      targetId: market.id,
      metadata: { title: market.title },
    },
  });

  return NextResponse.json({ ok: true, id: market.id, slug: market.slug });
}

async function uniqueSlug(title: string): Promise<string> {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "market";
  let slug = base;
  let i = 1;
  while (await db.market.findUnique({ where: { slug } })) {
    slug = `${base}-${i++}`;
  }
  return slug;
}
