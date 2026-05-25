import {
  db } from "@/lib/db";
import {
  Card,
  EmptyState,
  PageHeader,
  StatCard,
  Badge,
} from "@/components/admin/ui/primitives";
import { fmtDate } from "@/components/admin/ui/format";
import { IconBell, IconLightning } from "@/components/admin/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Notifications surface (PR-BET-ADMIN-REDESIGN).
 *
 * Reads the existing user-side Notification table (already wired
 * for in-app pings) and renders a recent-feed + category-breakdown
 * view. Rule-editor UI for outbound channels (email/SMS/push) is
 * scaffolded as the lower card and ships as a follow-up once the
 * NotificationRule table + channel sender pipeline are integrated
 * from the backend's existing outbox system.
 */
export default async function NotificationsPage() {
  const [recent, totalCount] = await Promise.all([
    db.notification.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { user: { select: { username: true } } },
    }),
    db.notification.count(),
  ]);

  return (
    <>
      <PageHeader
        kicker="Platform"
        title="Notifications"
        description="In-app pings already fire from the existing Notification table. Outbound channels (email / SMS / push) wire in via the backend outbox in a follow-up."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Pings (lifetime)"
          value={totalCount.toLocaleString("en-IN")}
          icon={<IconBell size={18} />}
        />
        <StatCard
          label="Channels enabled"
          value="In-app"
          hint="Email / SMS / push: pending backend wire-up"
          tone="info"
          icon={<IconLightning size={18} />}
        />
        <StatCard
          label="Recent (24h)"
          value={recent.length.toLocaleString("en-IN")}
          hint="Last 30 notifications fetched"
          icon={<IconBell size={18} />}
        />
      </div>

      {/* Recent feed. */}
      <Card className="mb-5 overflow-hidden">
        <div className="border-b border-[var(--admin-divider)] px-4 py-3">
          <div className="text-sm font-bold uppercase tracking-wider text-[var(--admin-text-primary)]">
            Recent notifications
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-[var(--admin-text-muted)]">
            <tr>
              <th className="px-3 py-2 text-left">User</th>
              <th className="px-3 py-2 text-left">Title</th>
              <th className="px-3 py-2 text-left">Body</th>
              <th className="px-3 py-2 text-right">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-divider)]">
            {recent.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <EmptyState
                    icon={<IconBell size={18} />}
                    title="No notifications yet"
                  />
                </td>
              </tr>
            )}
            {recent.map((n) => (
              <tr key={n.id}>
                <td className="px-3 py-2">@{n.user.username}</td>
                <td className="px-3 py-2">
                  <Badge>{n.title}</Badge>
                </td>
                <td className="px-3 py-2 max-w-[40ch] truncate text-[var(--admin-text-secondary)]">
                  {n.body}
                </td>
                <td className="px-3 py-2 text-right text-[11px] text-[var(--admin-text-secondary)]">
                  {fmtDate(n.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Channel rule scaffold (visual only; backend wire-up in follow-up). */}
      <Card className="p-4">
        <div className="text-sm font-bold text-[var(--admin-text-primary)]">
          Channel routing rules
        </div>
        <p className="mt-1 text-xs text-[var(--admin-text-secondary)]">
          When the backend NotificationRule table lands, this card flips
          into a per-event editor (market closed / order cancelled / refund
          processed / settlement complete / suspicious activity / KYC
          alerts) with email / SMS / push / in-app toggles.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {["market.closed", "order.cancelled", "refund.processed", "settlement.complete", "suspicious.activity", "kyc.status"].map((event) => (
            <li
              key={event}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-elevated)] px-3 py-2 text-xs"
            >
              <div className="font-mono text-[var(--admin-text-primary)]">{event}</div>
              <div className="mt-0.5 flex gap-1">
                <Badge>in-app</Badge>
                <Badge tone="info">email (pending)</Badge>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
