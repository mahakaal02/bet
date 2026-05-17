import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { db } from "@/lib/db";
import { fmtCoins } from "@/lib/utils";
import { Trophy } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const users = await db.user.findMany({
    orderBy: { xp: "desc" },
    take: 50,
    select: {
      id: true,
      username: true,
      xp: true,
      level: true,
      streak: true,
      image: true,
    },
  });

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-4 flex items-center gap-2">
          <Trophy className="h-6 w-6 text-amber-400" />
          <h1 className="text-2xl font-black">Leaderboard</h1>
        </div>
        <p className="text-sm text-slate-400">
          Top traders by total XP. Earn XP by trading — 1 XP per 20 coins spent.
        </p>

        <Card className="mt-4">
          <ol className="divide-y divide-slate-800">
            {users.length === 0 ? (
              <li className="py-6 text-center text-sm text-slate-500">
                No traders yet.
              </li>
            ) : (
              users.map((u, i) => (
                <li
                  key={u.id}
                  className="flex items-center justify-between py-3"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`grid h-8 w-8 place-items-center rounded-full text-xs font-bold ${
                        i === 0
                          ? "bg-amber-500/30 text-amber-200"
                          : i === 1
                            ? "bg-slate-300/20 text-slate-200"
                            : i === 2
                              ? "bg-orange-500/20 text-orange-200"
                              : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {i + 1}
                    </div>
                    <div>
                      <div className="font-semibold">{u.username}</div>
                      <div className="flex items-center gap-1 text-[10px] text-slate-500">
                        <Badge tone="info">Lvl {u.level}</Badge>
                        {u.streak > 0 && (
                          <Badge tone="warn">🔥 {u.streak}d</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm font-bold">
                      {fmtCoins(u.xp)}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">
                      XP
                    </div>
                  </div>
                </li>
              ))
            )}
          </ol>
        </Card>
      </div>
    </main>
  );
}
