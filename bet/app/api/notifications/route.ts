import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";

const PostBody = z.object({
  ids: z.array(z.string()).max(200).optional(),
  all: z.boolean().optional(),
});

/** List most recent notifications + unread count. */
export async function GET() {
  const u = await getAuthedUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [items, unread] = await Promise.all([
    db.notification.findMany({
      where: { userId: u.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.notification.count({ where: { userId: u.id, readAt: null } }),
  ]);
  return NextResponse.json({ items, unread });
}

/** Mark notifications as read. `{ all: true }` clears every unread row. */
export async function POST(req: Request) {
  const u = await getAuthedUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = PostBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  if (parsed.data.all) {
    await db.notification.updateMany({
      where: { userId: u.id, readAt: null },
      data: { readAt: new Date() },
    });
  } else if (parsed.data.ids && parsed.data.ids.length > 0) {
    await db.notification.updateMany({
      where: { userId: u.id, id: { in: parsed.data.ids } },
      data: { readAt: new Date() },
    });
  }

  return NextResponse.json({ ok: true });
}
