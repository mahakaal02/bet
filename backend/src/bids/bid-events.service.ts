import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export interface BidPlacedEvent {
  auctionId: string;
  userId: string;
}

/**
 * Bridges the REST bid-placement flow to the WebSocket gateway. The gateway
 * subscribes to [events$] at startup and pushes a re-classified status to
 * every subscriber of the affected auction whenever a bid lands.
 */
@Injectable()
export class BidEventsService {
  private readonly subject = new Subject<BidPlacedEvent>();
  readonly events$ = this.subject.asObservable();

  async broadcastBidPlaced(auctionId: string, userId: string) {
    this.subject.next({ auctionId, userId });
  }
}
