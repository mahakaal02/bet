import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";

/**
 * Catalog of all achievements + which ones this user has unlocked. Returned
 * as a single payload so the profile page can render the full grid (locked
 * cards greyed out) without two round-trips.
 */
export async function GET() {
  const u = await getAuthedUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [catalog, mine] = await Promise.all([
    db.achievement.findMany({ orderBy: { sortOrder: "asc" } }),
    db.userAchievement.findMany({
      where: { userId: u.id },
      orderBy: { unlockedAt: "desc" },
    }),
  ]);

  const unlockedAt = new Map(mine.map((m) => [m.achievementId, m.unlockedAt]));
  const items = catalog.map((a) => ({
    id: a.id,
    code: a.code,
    title: a.title,
    description: a.description,
    icon: a.icon,
    rewardCoins: a.rewardCoins,
    rewardXp: a.rewardXp,
    unlockedAt: unlockedAt.get(a.id) ?? null,
  }));

  return NextResponse.json({
    items,
    unlockedCount: mine.length,
    totalCount: catalog.length,
  });
}
