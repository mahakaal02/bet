import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { onWatchlistAdd } from "@/lib/achievements";

const Body = z.object({
  marketId: z.string().min(1),
  watching: z.boolean(),
});

export async function POST(req: Request) {
  const u = await getAuthedUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  if (parsed.data.watching) {
    await db.watchlist
      .create({
        data: { userId: u.id, marketId: parsed.data.marketId },
      })
      .catch(() => undefined); // unique violation = already watching
    await onWatchlistAdd(u.id);
  } else {
    await db.watchlist
      .delete({
        where: {
          userId_marketId: {
            userId: u.id,
            marketId: parsed.data.marketId,
          },
        },
      })
      .catch(() => undefined);
  }
  return NextResponse.json({ ok: true });
}
