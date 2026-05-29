import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

const Body = z.object({ like: z.boolean() });

// Toggle a like on a comment. The Comment model stores a simple `likeCount`
// counter (no per-user dedupe) — the client tracks its own liked state and
// tells us which direction to nudge. Clamp at zero. Anonymous-friendly for
// the demo, with a light per-IP rate limit to deter spam.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; commentId: string }> },
) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  const limit = rateLimit(`like:${ip}`, { limit: 30, windowMs: 30_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const { id, commentId } = await ctx.params;
  const market = await db.market.findFirst({
    where: { OR: [{ id }, { slug: id }] },
    select: { id: true },
  });
  if (!market) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const comment = await db.comment.findFirst({
    where: { id: commentId, marketId: market.id },
    select: { id: true, likeCount: true },
  });
  if (!comment) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const next = Math.max(
    0,
    comment.likeCount + (parsed.data.like ? 1 : -1),
  );
  const updated = await db.comment.update({
    where: { id: comment.id },
    data: { likeCount: next },
    select: { likeCount: true },
  });

  return NextResponse.json({ ok: true, likeCount: updated.likeCount });
}
