import { redirect } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { AdminAnalytics } from "@/components/AdminAnalytics";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { fmtCoins, timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const u = await getAuthedUser();
  if (!u) redirect("/login?next=/admin");
  if (!u.isAdmin) redirect("/");

  const [marketCount, userCount, tradeCount, recentMarkets, recentUsers, recentLogs] =
    await Promise.all([
      db.market.count(),
      db.user.count(),
      db.trade.count(),
      db.market.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { _count: { select: { trades: true, positions: true } } },
      }),
      db.user.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { wallet: true },
      }),
      db.adminLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { admin: { select: { username: true } } },
      }),
    ]);

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-black">Admin</h1>
          <Link
            href="/admin/markets/new"
            className="rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 px-4 py-2 text-sm font-bold text-slate-950"
          >
            New market
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <StatBig label="Markets" value={marketCount} />
          <StatBig label="Users" value={userCount} />
          <StatBig label="Trades" value={tradeCount} />
        </div>

        {/* Moderation shortcuts — these have their own dedicated pages, the
            chips here are just the discoverable entry points. */}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/admin/withdrawals"
            className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/20"
          >
            Withdrawals queue →
          </Link>
          <Link
            href="/admin/reports"
            className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-200 hover:bg-amber-500/20"
          >
            Reports queue →
          </Link>
          <Link
            href="/admin/comments"
            className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-800"
          >
            Moderate comments →
          </Link>
          <Link
            href="/admin/users"
            className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-800"
          >
            Manage users →
          </Link>
        </div>

        <div className="mt-4">
          <AdminAnalytics />
        </div>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Markets</CardTitle>
            <Link
              href="/admin/markets/new"
              className="text-xs text-cyan-300 hover:text-cyan-200"
            >
              + Create
            </Link>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-2 pr-2">Title</th>
                  <th className="py-2 pr-2">Cat</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Vol</th>
                  <th className="py-2 pr-2">Trades</th>
                  <th className="py-2 pr-2">Ends</th>
                  <th className="py-2 pr-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {recentMarkets.map((m) => (
                  <tr key={m.id}>
                    <td className="py-2 pr-2">
                      <Link
                        href={`/markets/${m.slug}`}
                        className="line-clamp-1 max-w-xs hover:text-slate-100"
                      >
                        {m.title}
                      </Link>
                    </td>
                    <td className="py-2 pr-2">
                      <Badge>{m.category}</Badge>
                    </td>
                    <td className="py-2 pr-2">
                      <Badge
                        tone={
                          m.status === "OPEN"
                            ? "info"
                            : m.status === "RESOLVED"
                              ? "yes"
                              : m.status === "CANCELLED"
                                ? "warn"
                                : "default"
                        }
                      >
                        {m.status}
                      </Badge>
                    </td>
                    <td className="py-2 pr-2 font-mono">
                      {fmtCoins(m.volumeCoins)}
                    </td>
                    <td className="py-2 pr-2 font-mono">
                      {m._count.trades}
                    </td>
                    <td className="py-2 pr-2 text-xs text-slate-500">
                      {new Date(m.endsAt).toLocaleDateString()}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      <Link
                        href={`/admin/markets/${m.id}`}
                        className="text-xs text-cyan-300 hover:text-cyan-200"
                      >
                        Manage →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Users</CardTitle>
              <Link
                href="/admin/users"
                className="text-xs text-cyan-300 hover:text-cyan-200"
              >
                All →
              </Link>
            </CardHeader>
            <ul className="divide-y divide-slate-800">
              {recentUsers.map((user) => (
                <li
                  key={user.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <div>
                    <div className="font-semibold">{user.username}</div>
                    <div className="text-[10px] text-slate-500">
                      {user.email} · {timeAgo(user.createdAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {user.banned && <Badge tone="no">Banned</Badge>}
                    {user.isAdmin && <Badge tone="warn">Admin</Badge>}
                    <span className="font-mono text-xs text-slate-400">
                      {fmtCoins(user.wallet?.balance ?? 0)}
                    </span>
                    <Link
                      href={`/admin/users/${user.id}`}
                      className="text-xs text-cyan-300 hover:text-cyan-200"
                    >
                      Edit
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Audit log</CardTitle>
            </CardHeader>
            {recentLogs.length === 0 ? (
              <p className="py-4 text-sm text-slate-500">No admin actions yet.</p>
            ) : (
              <ul className="divide-y divide-slate-800">
                {recentLogs.map((l) => (
                  <li key={l.id} className="py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-slate-300">
                        {l.action}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {timeAgo(l.createdAt)}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      by {l.admin.username}
                      {l.targetId && ` · target ${l.targetId.slice(0, 8)}…`}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </main>
  );
}

function StatBig({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass rounded-xl p-4">
      <div className="text-3xl font-black text-slate-100">{fmtCoins(value)}</div>
      <div className="text-xs uppercase tracking-wider text-slate-500">
        {label}
      </div>
    </div>
  );
}
