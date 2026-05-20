import { Inject, Injectable, Logger, Optional, forwardRef } from '@nestjs/common';
import { Notification, NotificationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationBroadcastGateway } from '../notification-broadcast.gateway';

/**
 * In-app channel adapter. Two-step delivery:
 *
 *   1. Persist the rendered body onto the `Notification` row
 *      (status → DELIVERED). The row is the source of truth for
 *      both unread badge counts and the "/notifications" list page.
 *   2. Best-effort push to the user's open WebSocket sessions via
 *      the broadcast gateway. If the user has no live socket, the
 *      next REST `GET /notifications` will pull the row anyway —
 *      WS is a latency optimisation, not a correctness requirement.
 *
 * Failure modes:
 *   - DB write fails → worker retries via the standard backoff (the
 *     row stays PENDING, no partial state).
 *   - WS broadcast fails → the DB row is still committed, just no
 *     real-time alert. The client polls / pulls on next mount.
 */
@Injectable()
export class InappAdapter {
  private readonly logger = new Logger(InappAdapter.name);

  constructor(
    private readonly prisma: PrismaService,
    // Gateway is forward-ref'd because it depends on this adapter at module load time
    // (the broadcast gateway also wants to call `unreadCount` on mount).
    @Optional()
    @Inject(forwardRef(() => NotificationBroadcastGateway))
    private readonly gateway?: NotificationBroadcastGateway,
  ) {}

  async deliver(
    row: Notification,
    rendered: { subject: string | null; body: string },
  ): Promise<void> {
    // Mark DELIVERED with the rendered content. We persist the
    // rendered body separately from the original payload so a later
    // template-version change doesn't retroactively rewrite the
    // notification the user saw.
    await this.prisma.notification.update({
      where: { id: row.id },
      data: {
        status: NotificationStatus.DELIVERED,
        rendered: {
          subject: rendered.subject,
          body: rendered.body,
        },
        deliveredAt: new Date(),
        lastAttemptAt: new Date(),
        deliveryAttempts: { increment: 1 },
      },
    });

    // Fire-and-forget WS broadcast. The gateway swallows its own errors.
    if (this.gateway) {
      this.gateway.broadcastNew(row.userId, {
        id: row.id,
        templateCode: row.templateCode,
        subject: rendered.subject,
        body: rendered.body,
        createdAt: row.createdAt.toISOString(),
      });
    }
  }
}
