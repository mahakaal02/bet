import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/Card";
import {
  backend,
  BackendUnauthorized,
  type NotificationListItem,
  type NotificationListResponse,
  type NotificationPreferences,
} from "@/lib/backend";
import { getSessionToken } from "@/lib/session";
import { cn, relativeTime } from "@/lib/utils";
import {
  DEFAULT_LOCALE,
  buildLocalizedMetadata,
  isLocale,
  localizedPath,
  t,
  type Locale,
} from "@/lib/i18n";
import { PreferencesClient } from "./PreferencesClient";
import { NotificationsMarkAllReadButton } from "./MarkAllReadButton";

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

/**
 * Notifications screen. Server-renders the last 20 in-app
 * notifications + the read/unread state + the user's preference
 * panel.
 *
 * Real-time updates are layered on top by a follow-up polish PR
 * (Socket.IO client island that opens against the new broadcast
 * gateway). For this first cut the page reads via REST and a
 * page refresh shows new entries — fine for the canary phase
 * where push-to-device is the primary channel.
 */
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
  const lp = (path: string) => localizedPath(path, locale);

  const token = await getSessionToken();
  if (!token) {
    redirect(`${lp("/login")}?next=${encodeURIComponent(lp("/notifications"))}`);
  }

  let list: NotificationListResponse = { items: [], nextCursor: null };
  let prefs: NotificationPreferences | null = null;
  let fetchError: string | null = null;

  try {
    const api = backend.authed(token);
    [list, prefs] = await Promise.all([
      api.get<NotificationListResponse>("/notifications?limit=20"),
      api.get<NotificationPreferences>("/notifications/preferences"),
    ]);
  } catch (e) {
    if (e instanceof BackendUnauthorized) {
      redirect(`${lp("/login")}?next=${encodeURIComponent(lp("/notifications"))}`);
    }
    fetchError = e instanceof Error ? e.message : tr("errors.genericNetwork");
  }

  const unreadCount = list.items.filter((n) => n.readAt == null).length;

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight">
              {tr("notifications.heading")}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              {unreadCount > 0
                ? tr("notifications.unreadCount", { count: unreadCount })
                : tr("notifications.allRead")}
            </p>
          </div>
          {list.items.length > 0 && unreadCount > 0 && (
            <NotificationsMarkAllReadButton />
          )}
        </div>

        {fetchError && (
          <Card className="mt-6 border-rose-500/30 bg-rose-500/5 text-sm text-rose-200">
            {fetchError}
          </Card>
        )}

        {list.items.length === 0 ? (
          <EmptyState message={tr("notifications.emptyState")} />
        ) : (
          <ul className="mt-6 space-y-2">
            {list.items.map((n) => (
              <NotificationRow key={n.id} item={n} />
            ))}
          </ul>
        )}

        {prefs && (
          <section className="mt-10">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">
              {tr("notifications.preferencesHeading")}
            </h2>
            <PreferencesClient initial={prefs} />
          </section>
        )}

        <p className="mt-8 text-center text-[11px] text-slate-600">
          Want device push too? Open the Kalki app on your phone — it&apos;ll
          register automatically.
        </p>
      </div>
    </main>
  );
}

function NotificationRow({ item }: { item: NotificationListItem }) {
  const unread = item.readAt == null;
  const ageMs = Date.now() - new Date(item.createdAt).getTime();
  return (
    <li>
      <Card
        className={cn(
          "flex items-start gap-3 transition",
          unread
            ? "border-cyan-500/30 bg-cyan-500/5"
            : "opacity-80 hover:opacity-100",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "mt-1.5 inline-block h-2 w-2 flex-shrink-0 rounded-full",
            unread ? "bg-cyan-400" : "bg-slate-700",
          )}
        />
        <div className="min-w-0 flex-1">
          {item.subject && (
            <p className="truncate text-sm font-semibold text-slate-100">
              {item.subject}
            </p>
          )}
          {/*
            Body has already been HTML-escaped server-side by the
            template renderer (`render({ escape: 'html' })`). React's
            default text escaping is a second layer of defence.
          */}
          <p
            className={cn(
              "text-sm leading-snug",
              item.subject ? "text-slate-400" : "text-slate-100",
            )}
          >
            {item.body}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {relativeTime(ageMs, "ago")}
          </p>
        </div>
      </Card>
    </li>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <Card className="mt-6 flex flex-col items-center gap-3 py-12 text-center">
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="text-slate-600"
      >
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      <p className="text-sm text-slate-400">{message}</p>
    </Card>
  );
}
