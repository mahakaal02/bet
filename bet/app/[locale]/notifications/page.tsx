import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/Card";
import { MarkAllReadButton } from "@/components/MarkAllReadButton";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { timeAgo } from "@/lib/utils";
import { Bell } from "lucide-react";
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
    path: "/notifications",
    title: t("meta.notificationsTitle", locale),
    description: t("meta.notificationsDescription", locale),
    noindex: true,
  });
}

export default async function NotificationsPage({
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
  if (!u) redirect(localizedPath("/login?next=/notifications", locale));

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
            {tr("notifications.heading")}
          </h1>
          {unread > 0 && <MarkAllReadButton />}
        </div>
        <p className="mb-4 text-sm text-slate-400">
          {unread > 0
            ? tr("notifications.unreadCount", { count: unread })
            : tr("notifications.allRead")}
        </p>

        <Card>
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              {tr("notifications.emptyState")}
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
