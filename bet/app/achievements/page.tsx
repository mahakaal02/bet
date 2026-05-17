import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { fmtCoins, timeAgo, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Achievements catalog. Server-renders the same data the `/profile` grid
 * surfaces — but in a dedicated page with criteria, unlock dates and a
 * "recently unlocked" rail. Anonymous visitors see the catalog with all
 * tiles locked (turns into a "what can I earn?" preview).
 */
export default async function AchievementsPage() {
  const u = await getAuthedUser();
  const [catalog, mine, totalUnlocked] = await Promise.all([
    db.achievement.findMany({ orderBy: { sortOrder: "asc" } }),
    u
      ? db.userAchievement.findMany({
          where: { userId: u.id },
          orderBy: { unlockedAt: "desc" },
        })
      : Promise.resolve([]),
    db.userAchievement.count(),
  ]);

  const unlockedAt = new Map(mine.map((m) => [m.achievementId, m.unlockedAt]));
  // Rarity = (unlocks of this badge) / (catalog count). For the demo we
  // don't have aggregate per-achievement counts in O(1); a fast group-by
  // pulls them all in one query.
  const grouped = await db.userAchievement.groupBy({
    by: ["achievementId"],
    _count: { achievementId: true },
  });
  const earnsByAch = new Map(
    grouped.map((g) => [g.achievementId, g._count.achievementId]),
  );

  const items = catalog.map((a) => {
    const earned = earnsByAch.get(a.id) ?? 0;
    return {
      ...a,
      unlockedAt: unlockedAt.get(a.id) ?? null,
      earnedCount: earned,
    };
  });

  const recent = mine
    .map((m) => {
      const a = catalog.find((c) => c.id === m.achievementId);
      if (!a) return null;
      return { ...a, unlockedAt: m.unlockedAt };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .slice(0, 6);

  const myCount = mine.length;

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black">Achievements</h1>
            <p className="text-sm text-slate-400">
              Earn badges by trading, claiming daily rewards, and inviting
              friends. Coins + XP for every unlock.
            </p>
          </div>
          {u && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2 text-right">
              <div className="text-2xl font-black text-cyan-300">
                {myCount}/{catalog.length}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">
                Unlocked
              </div>
            </div>
          )}
        </div>

        {u && recent.length > 0 && (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Recently unlocked</CardTitle>
              <span className="text-xs text-slate-500">{recent.length}</span>
            </CardHeader>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {recent.map((a) => (
                <div
                  key={a.id}
                  className="fade-up rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-2 text-center"
                >
                  <div className="text-3xl">{a.icon}</div>
                  <div className="mt-1 line-clamp-1 text-xs font-bold">
                    {a.title}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {timeAgo(a.unlockedAt)}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>All achievements</CardTitle>
            <span className="text-xs text-slate-500">
              {fmtCoins(totalUnlocked)} unlocks across all users
            </span>
          </CardHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((a) => {
              const unlocked = !!a.unlockedAt;
              const rarity = a.earnedCount; // raw count for the demo
              return (
                <div
                  key={a.id}
                  className={cn(
                    "fade-up rounded-xl border p-3 transition",
                    unlocked
                      ? "border-cyan-500/40 bg-gradient-to-br from-cyan-500/10 to-indigo-500/5"
                      : "border-slate-800 bg-slate-900/40",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "grid h-10 w-10 flex-shrink-0 place-items-center rounded-lg text-2xl",
                        unlocked
                          ? "bg-cyan-500/15"
                          : "bg-slate-800/60 grayscale opacity-60",
                      )}
                    >
                      {a.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-100">
                          {a.title}
                        </h3>
                        {unlocked ? (
                          <Badge tone="yes">Unlocked</Badge>
                        ) : (
                          <Badge>Locked</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs leading-snug text-slate-400">
                        {a.description}
                      </p>
                      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
                        <span className="font-mono">
                          +{fmtCoins(a.rewardCoins)} 🪙 · +{a.rewardXp} XP
                        </span>
                        <span>
                          {rarity > 0
                            ? `${fmtCoins(rarity)} earned`
                            : "Be the first"}
                        </span>
                      </div>
                      {unlocked && a.unlockedAt && (
                        <div className="mt-1 text-[10px] text-cyan-300">
                          Unlocked {timeAgo(a.unlockedAt)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {!u && (
          <Card className="mt-4 text-center">
            <p className="text-sm text-slate-300">
              Sign in to start earning achievements.
            </p>
            <Link
              href="/register"
              className="mt-2 inline-block rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 px-4 py-2 text-sm font-bold text-slate-950"
            >
              Create account
            </Link>
          </Card>
        )}
      </div>
    </main>
  );
}
