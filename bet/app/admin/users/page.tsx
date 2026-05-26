import { redirect } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { fmtCoins, timeAgo } from "@/lib/utils";
import { hubLoginUrl } from "@/lib/hub";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const u = await getAuthedUser();
  if (!u) redirect(hubLoginUrl());
  if (!u.isAdmin) redirect("/");

  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";

  const users = await db.user.findMany({
    where: q
      ? {
          OR: [
            { username: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { wallet: true },
  });

  return (
    <>
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-2xl font-black">Users</h1>
          <Link href="/admin" className="text-sm text-slate-400 hover:text-slate-200">
            ← Back to admin
          </Link>
        </div>
        <form method="get" className="mb-3">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search by username or email…"
            className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-sm"
          />
        </form>
        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-2 pr-2">Username</th>
                  <th className="py-2 pr-2">Email</th>
                  <th className="py-2 pr-2">Coins</th>
                  <th className="py-2 pr-2">XP</th>
                  <th className="py-2 pr-2">Flags</th>
                  <th className="py-2 pr-2">Joined</th>
                  <th className="py-2 pr-2 text-right">Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="py-2 pr-2 font-semibold">{user.username}</td>
                    <td className="py-2 pr-2 text-slate-400">{user.email}</td>
                    <td className="py-2 pr-2 font-mono">
                      {fmtCoins(user.wallet?.balance ?? 0)}
                    </td>
                    <td className="py-2 pr-2 font-mono">{user.xp}</td>
                    <td className="py-2 pr-2">
                      <div className="flex gap-1">
                        {user.isAdmin && <Badge tone="warn">Admin</Badge>}
                        {user.banned && <Badge tone="no">Banned</Badge>}
                      </div>
                    </td>
                    <td className="py-2 pr-2 text-xs text-slate-500">
                      {timeAgo(user.createdAt)}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      <Link
                        href={`/admin/users/${user.id}`}
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
      </div>
    </>
  );
}
