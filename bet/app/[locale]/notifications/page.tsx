import { redirect } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/Card";
import { MarkAllReadButton } from "@/components/MarkAllReadButton";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { timeAgo } from "@/lib/utils";
import { Bell } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const u = await getAuthedUser();
  if (!u) redirect("/login?next=/notifications");

  const [items, unread] = await Promise.all([
    db.notification.findMany({
      where: { userId: u.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.notification.count({ where: { userId: u.id, readAt: null } }),
  ]);

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-2xl font-black">
            <Bell className="h-6 w-6 text-cyan-400" />
            Notifications
          </h1>
          {unread > 0 && <MarkAllReadButton />}
        </div>
        <p className="mb-4 text-sm text-slate-400">
          {unread > 0 ? `${unread} unread.` : "All read."}
        </p>

        <Card>
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              You&apos;re all caught up. Trade something to get notifications
              flowing.
            </p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {items.map((n) => (
                <li key={n.id} className="py-3">
                  <Link
                    href={n.href ?? "#"}
                    className="block hover:bg-slate-900/40"
                  >
                    <div className="flex items-start gap-3">
                      {!n.readAt && (
                        <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-cyan-400" />
                      )}
                      <div className="flex-1">
                        <div className="font-semibold text-slate-100">
                          {n.title}
                        </div>
                        <p className="mt-0.5 text-sm text-slate-400">{n.body}</p>
                        <div className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">
                          {timeAgo(n.createdAt)}
                        </div>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </main>
  );
}
