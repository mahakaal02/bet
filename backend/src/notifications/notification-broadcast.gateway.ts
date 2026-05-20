import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';

interface JwtPayload { sub: string; username: string }

/**
 * Real-time notification gateway. One Socket.IO namespace at
 * `/notifications/socket.io`. Each authenticated socket subscribes
 * to a per-user room `user:{userId}` — server-side broadcasts to
 * the room push only to that user's open tabs.
 *
 * Events:
 *   server → client:
 *     NOTIFICATION_NEW   { id, templateCode, subject, body, createdAt }
 *     NOTIFICATION_READ  { id }              // cross-tab read sync
 *     UNREAD_COUNT       { count }           // pushed on connect + on changes
 *
 *   client → server:
 *     MARK_READ          { id }              // acks via callback
 *     MARK_ALL_READ      {}                  // acks via callback
 *
 * Auth: same JWT handshake as the aviator gateway — token comes in
 * the `auth.token` field of the Socket.IO handshake. Unauthenticated
 * sockets are disconnected immediately.
 *
 * Failure modes:
 *   - Token forgery → JWT verify throws → socket disconnect with
 *     reason "unauthorized".
 *   - DB unreachable when fetching unread count → log + send 0 as
 *     conservative default (better than blocking the connection).
 *   - Broadcast to a room with no subscribers → silent no-op
 *     (Socket.IO handles this).
 */
@WebSocketGateway({
  path: '/notifications/socket.io',
  cors: { origin: true, credentials: true },
})
export class NotificationBroadcastGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NotificationBroadcastGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token;
    if (typeof token !== 'string' || !token) {
      client.disconnect(true);
      return;
    }
    try {
      const claims = this.jwt.verify<JwtPayload>(token);
      const userId = claims.sub;
      client.data.userId = userId;
      await client.join(`user:${userId}`);

      // Push the unread count on connect so the badge renders
      // immediately without an extra REST call.
      const count = await this.unreadCount(userId);
      client.emit('UNREAD_COUNT', { count });
    } catch (e) {
      this.logger.warn(`unauth notification socket: ${(e as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    // Socket.IO auto-leaves rooms on disconnect; nothing to do.
    this.logger.debug(`socket ${client.id} disconnected`);
  }

  @SubscribeMessage('MARK_READ')
  async markRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { id?: string },
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId || !body?.id) return { ok: false, error: 'invalid_input' };

    const result = await this.prisma.notification.updateMany({
      where: { id: body.id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count > 0) {
      // Cross-tab sync — broadcast to user's other open sockets.
      this.server.to(`user:${userId}`).emit('NOTIFICATION_READ', { id: body.id });
      const count = await this.unreadCount(userId);
      this.server.to(`user:${userId}`).emit('UNREAD_COUNT', { count });
    }
    return { ok: true };
  }

  @SubscribeMessage('MARK_ALL_READ')
  async markAllRead(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId as string | undefined;
    if (!userId) return { ok: false, error: 'unauth' };

    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    this.server.to(`user:${userId}`).emit('UNREAD_COUNT', { count: 0 });
    return { ok: true };
  }

  /**
   * Public — called from `InappAdapter.deliver()` to push a newly
   * delivered in-app notification to the user's open sockets.
   */
  broadcastNew(
    userId: string,
    payload: { id: string; templateCode: string; subject: string | null; body: string; createdAt: string },
  ) {
    this.server.to(`user:${userId}`).emit('NOTIFICATION_NEW', payload);
    // The badge needs to bump too. Compute the new count and push.
    void this.unreadCount(userId).then((count) => {
      this.server.to(`user:${userId}`).emit('UNREAD_COUNT', { count });
    });
  }

  private async unreadCount(userId: string): Promise<number> {
    try {
      return await this.prisma.notification.count({
        where: { userId, readAt: null },
      });
    } catch (e) {
      this.logger.error(`unreadCount failed for ${userId}: ${(e as Error).message}`);
      return 0;
    }
  }
}
