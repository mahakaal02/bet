import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { UserAdminPanel } from "@/components/UserAdminPanel";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { fmtCoins, timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const u = await getAuthedUser();
  if (!u) redirect(`/login?next=/admin/users/${id}`);
  if (!u.isAdmin) redirect("/");

  const user = await db.user.findUnique({
    where: { id },
    include: { wallet: true, _count: { select: { trades: true, positions: true } } },
  });
  if (!user) notFound();

  return (
    <>
      <div className="mx-auto max-w-3xl px-4 py-6">
        <Link
          href="/admin/users"
          className="mb-3 inline-block text-sm text-slate-400 hover:text-slate-200"
        >
          ← All users
        </Link>
        <h1 className="text-2xl font-black">{user.username}</h1>
        <p className="text-xs text-slate-500">{user.email}</p>

        <div className="mt-3 flex flex-wrap gap-2">
          {user.isAdmin && <Badge tone="warn">Admin</Badge>}
          {user.banned && <Badge tone="no">Banned</Badge>}
          <Badge>Joined {timeAgo(user.createdAt)}</Badge>
          <Badge>
            {user._count.trades} trades · {user._count.positions} positions
          </Badge>
        </div>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Wallet</CardTitle>
          </CardHeader>
          <div className="text-3xl font-black text-cyan-300">
            {fmtCoins(user.wallet?.balance ?? 0)} 🪙
          </div>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Admin actions</CardTitle>
          </CardHeader>
          <UserAdminPanel
            userId={user.id}
            initial={{
              isAdmin: user.isAdmin,
              banned: user.banned,
              balance: user.wallet?.balance ?? 0,
            }}
          />
        </Card>
      </div>
    </>
  );
}
