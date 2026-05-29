import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import "../markets/markets-v2.css";
import {
  ExchangeTopbar,
  ExchangeFooter,
  ExchangeBackdrop,
} from "@/components/ExchangeChrome";
import { MarkAllReadButton } from "@/components/MarkAllReadButton";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { timeAgo } from "@/lib/utils";
import {
  DEFAULT_LOCALE,
  buildAuthRedirect,
  buildLocalizedMetadata,
  isLocale,
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

/**
 * Notifications inbox — re-skinned onto the Markets v2 system (shared
 * chrome + panel list) so it matches the rest of the exchange. The
 * MarkAllReadButton client island is preserved.
 */
export default async function NotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);

  const u = await getAuthedUser();
  if (!u) {
    const sp = await searchParams;
    redirect(buildAuthRedirect("/notifications", sp, locale));
  }

  const [items, unread] = await Promise.all([
    db.notification.findMany({
      where: { userId: u.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.notification.count({ where: { userId: u.id, readAt: null } }),
  ]);

  return (
    <div className="mkt">
      <ExchangeBackdrop />
      <ExchangeTopbar locale={locale} />

      <main className="page content">
        <div className="page-head">
          <div>
            <div className="crumbs">
              <span>{tr("market.crumbTrade")}</span>
              <span className="sep">/</span>
              <span className="here">{tr("notifications.heading")}</span>
            </div>
            <h1 className="page-title">
              <em>{tr("notifications.heading")}</em>
            </h1>
            <p className="page-sub">
              {unread > 0
                ? tr("notifications.unreadCount", { count: unread })
                : tr("notifications.allRead")}
            </p>
          </div>
          {unread > 0 && (
            <div className="page-stats">
              <MarkAllReadButton />
            </div>
          )}
        </div>

        <div className="narrow">
          <section className="panel">
            {items.length === 0 ? (
              <p
                className="panel-sub"
                style={{ textAlign: "center", padding: "32px 0" }}
              >
                {tr("notifications.emptyState")}
              </p>
            ) : (
              <ul className="list">
                {items.map((n) => (
                  <li key={n.id}>
                    <Link className="list-row" href={n.href ?? "#"}>
                      {!n.readAt && <span className="dot-unread" />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="list-title">{n.title}</div>
                        <p className="list-body">{n.body}</p>
                        <div className="list-time">{timeAgo(n.createdAt)}</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>

      <ExchangeFooter locale={locale} />
    </div>
  );
}
