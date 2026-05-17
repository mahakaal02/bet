import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

const Body = z.object({ body: z.string().min(1).max(500) });

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  // Comments page accepts either market id or slug — try both.
  const market = await db.market.findFirst({
    where: { OR: [{ id }, { slug: id }] },
    select: { id: true },
  });
  if (!market) return NextResponse.json({ comments: [] });
  const comments = await db.comment.findMany({
    where: { marketId: market.id, hidden: false },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { user: { select: { username: true } } },
  });
  return NextResponse.json({ comments });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const u = await getAuthedUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limit = rateLimit(`comment:${u.id}`, { limit: 5, windowMs: 30_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const { id } = await ctx.params;
  const market = await db.market.findFirst({
    where: { OR: [{ id }, { slug: id }] },
    select: { id: true },
  });
  if (!market) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const c = await db.comment.create({
    data: {
      marketId: market.id,
      userId: u.id,
      body: parsed.data.body.trim(),
    },
  });
  return NextResponse.json({ ok: true, id: c.id });
}
