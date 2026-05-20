import { Injectable, Logger } from '@nestjs/common';
import { Notification, NotificationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications.service';

/**
 * Push-channel adapter for the new notification queue. Reuses the
 * existing FCM-backed `NotificationsService.notifyUser()` (which
 * already handles dead-token pruning) and translates retryable vs
 * permanent errors into the Notification row's status.
 *
 * Status transitions:
 *   PENDING → SENT       on first successful FCM ack
 *   PENDING → RETRY      on transient (5xx, network) failure
 *   PENDING → FAILED     on `messaging/registration-token-not-registered`
 *                        or `invalid-argument` (token is dead, no point
 *                        retrying — also auto-pruned by FCM service)
 *
 * The worker (`notification.worker.ts`) consults
 * `OutboxService.nextAttemptAt(attempts)` to schedule the next retry
 * for RETRY rows.
 */
@Injectable()
export class PushAdapter {
  private readonly logger = new Logger(PushAdapter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: NotificationsService,
  ) {}

  async deliver(
    row: Notification,
    rendered: { subject: string | null; body: string },
  ): Promise<{ ok: boolean; permanent?: boolean; error?: string }> {
    // FCM expects title + body (both required for visible push).
    // Subject is optional in the template — fall back to a default.
    const title = rendered.subject ?? 'Kalki';
    try {
      await this.push.notifyUser(row.userId, {
        title,
        body: rendered.body,
        data: {
          notificationId: row.id,
          templateCode: row.templateCode,
        },
      });
      await this.markSent(row);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Permanent failures = token-related. The underlying service
      // already prunes dead tokens; we just mark the row FAILED.
      const permanent =
        msg.includes('registration-token-not-registered') ||
        msg.includes('invalid-argument');
      if (permanent) {
        await this.markFailed(row, msg);
      } else {
        await this.markRetry(row, msg);
      }
      return { ok: false, permanent, error: msg };
    }
  }

  private markSent(row: Notification) {
    return this.prisma.notification.update({
      where: { id: row.id },
      data: {
        status: NotificationStatus.SENT,
        lastAttemptAt: new Date(),
        deliveredAt: new Date(),
        deliveryAttempts: { increment: 1 },
      },
    });
  }

  private markRetry(row: Notification, reason: string) {
    return this.prisma.notification.update({
      where: { id: row.id },
      data: {
        status: NotificationStatus.RETRY,
        lastAttemptAt: new Date(),
        failureReason: reason.slice(0, 500),
        deliveryAttempts: { increment: 1 },
      },
    });
  }

  private markFailed(row: Notification, reason: string) {
    return this.prisma.notification.update({
      where: { id: row.id },
      data: {
        status: NotificationStatus.FAILED,
        lastAttemptAt: new Date(),
        failureReason: reason.slice(0, 500),
        deliveryAttempts: { increment: 1 },
      },
    });
  }
}
