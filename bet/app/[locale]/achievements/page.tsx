import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { fmtCoins, timeAgo, cn } from "@/lib/utils";
import {
  DEFAULT_LOCALE,
  buildLocalizedMetadata,
  isLocale,
  localizedPath,
  t,
  type Locale,
} from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  return buildLocalizedMetadata({
    locale,
    path: "/achievements",
    title: t("meta.achievementsTitle", locale),
    description: t("meta.achievementsDescription", locale),
  });
}

/**
 * Achievements catalog. Server-renders the same data the `/profile` grid
 * surfaces — but in a dedicated page with criteria, unlock dates and a
 * "recently unlocked" rail. Anonymous visitors see the catalog with all
 * tiles locked (turns into a "what can I earn?" preview).
 */
export default async function AchievementsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);

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
            <h1 className="text-2xl font-black">{tr("achievements.heading")}</h1>
            <p className="text-sm text-slate-400">
              {tr("achievements.subtext")}
            </p>
          </div>
          {u && (
            <div
              className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2 text-end"
              aria-label={tr("achievements.unlockedCount", {
                count: myCount,
                total: catalog.length,
              })}
            >
              <div className="text-2xl font-black text-cyan-300">
                {myCount}/{catalog.length}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">
                {tr("achievements.badge")}
              </div>
            </div>
          )}
        </div>

        {u && recent.length > 0 && (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle>{tr("achievements.recentlyUnlocked")}</CardTitle>
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
            <CardTitle>{tr("achievements.allAchievements")}</CardTitle>
            <span className="text-xs text-slate-500">
              {tr("achievements.unlocksAcrossUsers", {
                count: fmtCoins(totalUnlocked),
              })}
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
                          <Badge tone="yes">{tr("achievements.badge")}</Badge>
                        ) : (
                          <Badge>{tr("achievements.locked")}</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs leading-snug text-slate-400">
                        {a.description}
                      </p>
                      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
                        <span className="font-mono">
                          {tr("achievements.reward", {
                            coins: fmtCoins(a.rewardCoins),
                            xp: a.rewardXp,
                          })}
                        </span>
                        <span>
                          {rarity > 0
                            ? tr("achievements.earned", {
                                count: fmtCoins(rarity),
                              })
                            : tr("achievements.beFirst")}
                        </span>
                      </div>
                      {unlocked && a.unlockedAt && (
                        <div className="mt-1 text-[10px] text-cyan-300">
                          {tr("achievements.unlockedTime", {
                            time: timeAgo(a.unlockedAt),
                          })}
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
              {tr("achievements.signInNote")}
            </p>
            <Link
              href={localizedPath("/register", locale)}
              className="mt-2 inline-block rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 px-4 py-2 text-sm font-bold text-slate-950"
            >
              {tr("achievements.createAccount")}
            </Link>
          </Card>
        )}
      </div>
    </main>
  );
}
