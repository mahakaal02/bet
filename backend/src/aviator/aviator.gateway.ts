import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Server as SocketIoServer, Socket } from 'socket.io';
import { JwtPayload } from '../auth/auth.service';
import { AviatorChatService } from './chat.service';
import { AviatorState } from './aviator-state';

/**
 * Socket.IO surface for Aviator (PR-ARCH-AUDIT, Stage B — extracted
 * from the AviatorService god-class).
 *
 * Owns:
 *   - the Socket.IO server (path `/aviator/socket.io`)
 *   - JWT authentication on connection (verified once at connect via
 *     `io.use` middleware; identity cached on `socket.data`)
 *   - CHAT_SEND relay → AviatorChatService → CHAT_MESSAGE broadcast
 *   - ONLINE_COUNT publication on (dis)connect
 *
 * Does NOT own:
 *   - game-loop emits (GAME_START, GAME_RUNNING, MULTIPLIER_UPDATE,
 *     GAME_CRASH, PLAYER_BET, PLAYER_CASHOUT, SEED_ROTATED) — those
 *     are emitted by RoundLifecycle + BetSettlement via `emit()`.
 *
 * Why connect-time JWT only: the round state machine is the source
 * of truth for what a connected user can DO (place bet → REST goes
 * through JwtAuthGuard which re-verifies; cashout → ditto). The WS
 * connection itself is just a push channel.
 */
@Injectable()
export class AviatorGateway implements OnModuleDestroy {
  private readonly logger = new Logger(AviatorGateway.name);
  private io?: SocketIoServer;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly jwt: JwtService,
    private readonly chat: AviatorChatService,
    private readonly state: AviatorState,
  ) {}

  attach(): void {
    if (this.io) return;
    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer();
    if (!httpServer) {
      // Worker-mode boot (KALKI_ROLE=worker) — no HTTP server is
      // listening, so we can't attach a Socket.IO server. The
      // round-state machine still runs (driven by RoundLifecycle's
      // timers); emits become no-ops via the optional-chain in
      // `emit()`.
      this.logger.log('no HTTP server (worker mode?) — Aviator gateway inert');
      return;
    }
    this.io = new SocketIoServer(httpServer, {
      cors: { origin: '*' },
      path: '/aviator/socket.io',
    });

    this.io.use(async (socket, next) => {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (socket.handshake.query?.token as string | undefined);
      if (!token) return next(new Error('unauthorized'));
      try {
        const payload = this.jwt.verify<JwtPayload>(token);
        socket.data.userId = payload.sub;
        socket.data.username = payload.username;
        return next();
      } catch {
        return next(new Error('unauthorized'));
      }
    });

    this.io.on('connection', (socket: Socket) => {
      // Snapshot of state + history so a freshly-connected client
      // renders a complete UI without any extra REST calls.
      socket.emit('STATE_SNAPSHOT', this.state.snapshotPublic());
      socket.emit('PLAYER_ROSTER', this.state.publicRoster());
      socket.emit('RECENT_WINNERS', this.state.recentWinners);
      void this.chat
        .recent(50)
        .then((messages) => socket.emit('CHAT_HISTORY', messages))
        .catch(() => {});

      socket.on(
        'CHAT_SEND',
        async (
          payload: { message?: string },
          ack?: (r: unknown) => void,
        ) => {
          const message = (payload?.message ?? '').toString();
          try {
            const userId = socket.data.userId as string;
            const username = socket.data.username as string;
            const sent = await this.chat.send(userId, username, message);
            this.io?.emit('CHAT_MESSAGE', sent);
            ack?.({ ok: true, id: sent.id });
          } catch (e: unknown) {
            ack?.({
              ok: false,
              error: e instanceof Error ? e.message : 'send failed',
            });
          }
        },
      );

      this.broadcastPlayerCount();
      socket.on('disconnect', () => this.broadcastPlayerCount());
    });

    this.logger.log('Aviator socket.io attached at /aviator/socket.io');
  }

  /**
   * Fan-out an event to every connected client. No-op when the
   * gateway is inert (worker mode or pre-attach). Game services
   * call this — they don't need to import socket.io.
   */
  emit(event: string, payload: unknown): void {
    this.io?.emit(event, payload);
  }

  /**
   * Current connection count (passive viewers + active players).
   * Used by analytics endpoints. Returns 0 in worker mode.
   */
  getOnlineCount(): number {
    return this.io?.engine?.clientsCount ?? 0;
  }

  onModuleDestroy(): void {
    this.io?.close();
  }

  private broadcastPlayerCount(): void {
    this.io?.emit('ONLINE_COUNT', { count: this.io.engine.clientsCount });
  }
}
