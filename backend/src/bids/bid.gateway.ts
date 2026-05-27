import { Logger, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import Decimal from 'decimal.js';
import { WebSocket, WebSocketServer as WsServer } from 'ws';
import { AuthService, JwtPayload } from '../auth/auth.service';
import { BidsService } from './bids.service';
import { BidEventsService } from './bid-events.service';
import { classifyBidFor } from './bidding-engine';

interface ClientState {
  userId: string;
  auctionId: string | null;
}

type Inbound =
  | { type: 'subscribe'; auctionId: string; token: string }
  | { type: 'unsubscribe' };

/**
 * The new bid-status protocol (pay-then-see-status):
 *
 *   Client → Server:
 *     {"type":"subscribe", "auctionId":"…", "token":"<jwt>"}
 *     {"type":"unsubscribe"}
 *
 *   Server → Client:
 *     {"type":"subscribed", "auctionId":"…"}
 *     {"type":"status",     "auctionId":"…", "amount":"…", "kind":"…"}
 *     {"type":"error",      "message":"…"}
 *
 * Status is pushed by the SERVER only — never in response to a typed
 * candidate. Triggers:
 *   1. On subscribe, if the user already has a bid on this auction.
 *   2. After ANY bid is placed on this auction, each subscriber receives
 *      the latest status of THEIR most recent bid (re-classified against
 *      the new global state).
 */
@WebSocketGateway({ path: '/ws' })
export class BidGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  private readonly logger = new Logger(BidGateway.name);
  private readonly clients = new Map<WebSocket, ClientState>();

  @WebSocketServer()
  private server!: WsServer;

  constructor(
    private readonly jwt: JwtService,
    private readonly bids: BidsService,
    private readonly events: BidEventsService,
    // PR-ARCH-AUDIT Stage F — use AuthService.validateJwt so a
    // password-reset's `passwordChangedAt` bump invalidates any
    // live WS subscription, not just future REST calls.
    private readonly auth: AuthService,
  ) {}

  onModuleInit() {
    this.events.events$.subscribe(({ auctionId }) => {
      void this.refreshAuction(auctionId);
    });
  }

  handleConnection(client: WebSocket) {
    this.clients.set(client, { userId: '', auctionId: null });
    client.on('message', (raw) => this.onMessage(client, raw.toString()));
  }

  handleDisconnect(client: WebSocket) {
    this.clients.delete(client);
  }

  private async onMessage(client: WebSocket, raw: string) {
    let msg: Inbound;
    try {
      msg = JSON.parse(raw);
    } catch {
      return this.sendError(client, 'malformed json');
    }

    const state = this.clients.get(client);
    if (!state) return;

    try {
      switch (msg.type) {
        case 'subscribe': {
          // Two-step verification (PR-ARCH-AUDIT, Stage F):
          //   1. JWT signature + expiry via jwt.verify().
          //   2. passwordChangedAt + RG check via auth.validateJwt().
          // Step 2 is what catches a token that's cryptographically
          // valid but stale (user just rotated their password).
          const payload = this.jwt.verify<JwtPayload>(msg.token);
          await this.auth.validateJwt(payload);
          state.userId = payload.sub;
          state.auctionId = msg.auctionId;
          this.send(client, { type: 'subscribed', auctionId: msg.auctionId });
          // Immediately push the status of this user's latest placed bid,
          // if any — so reload-then-resubscribe shows current standing.
          await this.pushStatusFor(client, state);
          break;
        }
        case 'unsubscribe':
          state.auctionId = null;
          break;
        default:
          this.sendError(
            client,
            'unsupported message type — status is shown after a bid is placed',
          );
      }
    } catch (e: any) {
      this.sendError(client, e?.message ?? 'error');
    }
  }

  /**
   * Re-evaluate every connected subscriber of [auctionId] against the new
   * bid state. Called whenever a bid is placed via REST. Uses
   * `classifyBidFor` (timestamped) so FIXED_WINNER mode resolves to the
   * earliest bidder at the rigged amount.
   */
  private async refreshAuction(auctionId: string) {
    const subscribers: Array<[WebSocket, ClientState]> = [];
    for (const [ws, st] of this.clients) {
      if (st.auctionId === auctionId && st.userId) subscribers.push([ws, st]);
    }
    if (subscribers.length === 0) return;

    const [allBids, opts] = await Promise.all([
      this.bids.fetchBidRows(auctionId),
      this.bids.classifyOptsForAuction(auctionId),
    ]);
    for (const [ws, st] of subscribers) {
      const latest = await this.bids.getLatestBidForUser(auctionId, st.userId);
      if (!latest) continue;
      const amount = new Decimal(latest.amount.toString());
      const kind = classifyBidFor(latest.id, allBids, opts);
      this.send(ws, {
        type: 'status',
        auctionId,
        amount: amount.toFixed(2),
        kind,
      });
    }
  }

  private async pushStatusFor(client: WebSocket, state: ClientState) {
    if (!state.auctionId || !state.userId) return;
    const latest = await this.bids.getLatestBidForUser(state.auctionId, state.userId);
    if (!latest) return;
    const [allBids, opts] = await Promise.all([
      this.bids.fetchBidRows(state.auctionId),
      this.bids.classifyOptsForAuction(state.auctionId),
    ]);
    const amount = new Decimal(latest.amount.toString());
    const kind = classifyBidFor(latest.id, allBids, opts);
    this.send(client, {
      type: 'status',
      auctionId: state.auctionId,
      amount: amount.toFixed(2),
      kind,
    });
  }

  private send(client: WebSocket, msg: unknown) {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(msg));
  }

  private sendError(client: WebSocket, message: string) {
    this.send(client, { type: 'error', message });
  }
}
