import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { NotificationStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * User-facing notification list + read-state API. Paired with the
 * realtime gateway (`notification-broadcast.gateway.ts`) — clients
 * use this REST endpoint on mount/refresh and the WS for live
 * updates after that.
 *
 * Routes:
 *   GET    /notifications              list (paginated)
 *   GET    /notifications/unread-count  badge counter
 *   PATCH  /notifications/:id/read     mark single
 *   POST   /notifications/read-all     mark all
 *
 * Filters: `?unread=true` (default false), `?cursor=<id>&limit=20`.
 *
 * All in-app channel only. Push + email don't surface as REST list
 * entries — they're already in the user's phone / inbox.
 */
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsListController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Throttle({ list: { limit: 60, ttl: 60_000 } })
  async list(
    @CurrentUser() user: AuthedUser,
    @Query('unread') unread?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const limit = Math.max(1, Math.min(50, Number(limitRaw) || 20));
    const onlyUnread = unread === 'true';

    const rows = await this.prisma.notification.findMany({
      where: {
        userId: user.id,
        channel: 'INAPP',
        status: { in: [NotificationStatus.DELIVERED, NotificationStatus.SENT] },
        ...(onlyUnread ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        templateCode: true,
        rendered: true,
        readAt: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((r) => {
      const rendered = (r.rendered ?? {}) as { subject?: string | null; body?: string };
      return {
        id: r.id,
        templateCode: r.templateCode,
        subject: rendered.subject ?? null,
        body: rendered.body ?? '',
        readAt: r.readAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      };
    });
    return {
      items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthedUser) {
    const count = await this.prisma.notification.count({
      where: { userId: user.id, channel: 'INAPP', readAt: null },
    });
    return { count };
  }

  @Patch(':id/read')
  async markRead(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    const result = await this.prisma.notification.updateMany({
      where: { id, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: result.count > 0 };
  }

  @Post('read-all')
  async readAll(@CurrentUser() user: AuthedUser) {
    const result = await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { marked: result.count };
  }
}
