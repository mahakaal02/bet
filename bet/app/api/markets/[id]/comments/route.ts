import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

const Body = z.object({
  body: z.string().min(1).max(500),
  parentId: z.string().optional(),
});

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

  // Fetch all visible comments for the market, then assemble a single-level
  // tree: top-level comments (parentId == null) each carry a `replies[]`
  // array sorted oldest-first (Instagram-style), top-level newest-first.
  const rows = await db.comment.findMany({
    where: { marketId: market.id, hidden: false },
    orderBy: { createdAt: "asc" },
    take: 500,
    include: { user: { select: { username: true } } },
  });

  type Row = (typeof rows)[number];
  const shape = (c: Row) => ({
    id: c.id,
    body: c.body,
    createdAt: c.createdAt,
    likeCount: c.likeCount,
    parentId: c.parentId,
    user: c.user,
  });

  const repliesByParent = new Map<string, ReturnType<typeof shape>[]>();
  for (const c of rows) {
    if (c.parentId) {
      const arr = repliesByParent.get(c.parentId) ?? [];
      arr.push(shape(c));
      repliesByParent.set(c.parentId, arr);
    }
  }

  const comments = rows
    .filter((c) => !c.parentId)
    .map((c) => ({ ...shape(c), replies: repliesByParent.get(c.id) ?? [] }))
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

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

  // If replying, resolve to a top-level parent (single-level threading) and
  // verify the parent belongs to the same market.
  let parentId: string | null = null;
  if (parsed.data.parentId) {
    const parent = await db.comment.findFirst({
      where: { id: parsed.data.parentId, marketId: market.id },
      select: { id: true, parentId: true },
    });
    if (!parent) {
      return NextResponse.json({ error: "invalid_parent" }, { status: 400 });
    }
    parentId = parent.parentId ?? parent.id;
  }

  const c = await db.comment.create({
    data: {
      marketId: market.id,
      userId: u.id,
      body: parsed.data.body.trim(),
      parentId,
    },
  });
  return NextResponse.json({ ok: true, id: c.id });
}
