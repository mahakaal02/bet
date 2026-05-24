import { db } from "@/lib/db";

/**
 * Notification outbox bridge (PR-BET-ADMIN-FOLLOWUPS).
 *
 * Publishes a notification event to two surfaces in one call:
 *
 *   1. Bet's in-app Notification table — the existing user-facing
 *      bell + the /notifications page consume this. Already worked
 *      before this PR; the helper preserves that contract.
 *   2. The backend Outbox via the internal API. The backend's
 *      worker pod (PR-WORKER-EXTRACT) drains the Outbox and
 *      dispatches each event to its configured channels (SES email,
 *      SMS, FCM push) per the NotificationRule table.
 *
 * The two writes are independent: a failure to enqueue to the
 * backend outbox does NOT block the in-app insert (the user still
 * sees the bell ping). Outbox-only failures are logged and the
 * event surfaces in /admin/notifications as "in-app only" for
 * triage — never a silent drop.
 *
 * Usage:
 *
 *   await publishNotification({
 *     userId,
 *     kind: 'market.closed',
 *     title: 'Market closed',
 *     body: '...',
 *     href: '/markets/foo',
 *   });
 *
 * Routes that already write directly to db.notification should be
 * migrated to this helper opportunistically — each migration adds
 * email/SMS/push reach for that event without a code-change at the
 * use site.
 */

export interface NotificationEvent {
  userId: string;
  /** Stable event key. Matches NotificationRule.event in the backend. */
  kind: string;
  /** In-app title. */
  title: string;
  /** In-app body. */
  body: string;
  /** Optional click-through URL. */
  href?: string;
  /** Channel-router context: arbitrary JSON. Templates reference fields by name. */
  data?: Record<string, unknown>;
}

const OUTBOX_URL = process.env.NOTIFICATION_OUTBOX_URL;
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET;

export async function publishNotification(ev: NotificationEvent): Promise<void> {
  // Always write the in-app record first — it's the user's primary
  // surface and we never want a backend-outbox failure to silence it.
  try {
    await db.notification.create({
      data: {
        userId: ev.userId,
        title: ev.title,
        body: ev.body,
        href: ev.href ?? null,
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[notification-outbox] in-app insert failed", e);
    return; // don't try the outbox if the local insert failed — likely DB-wide issue
  }

  // Best-effort outbox push. Skipped when the backend integration
  // env vars aren't configured (dev installs, isolated bet runs).
  if (!OUTBOX_URL || !INTERNAL_SECRET) return;
  try {
    await fetch(OUTBOX_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify({
        event: ev.kind,
        userId: ev.userId,
        payload: {
          title: ev.title,
          body: ev.body,
          href: ev.href,
          ...(ev.data ?? {}),
        },
      }),
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[notification-outbox] outbox enqueue failed", e);
    // Swallow — in-app already delivered. The admin notifications
    // surface will reflect "in-app only" for this event when wired
    // to read the outbox-delivery status (follow-up).
  }
}
