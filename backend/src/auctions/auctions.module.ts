import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { BidsModule } from '../bids/bids.module';
import { OrdersModule } from '../orders/orders.module';
import { AuctionsController } from './auctions.controller';
import { AuctionsService } from './auctions.service';
import { AuctionScheduler } from './auction-scheduler';

@Module({
  // BidsModule re-export gives us `BidsService` + `BidEventsService` —
  // the admin update path needs them to run the ringmaster cascade and
  // notify subscribers when a LIVE auction flips into NO_WINNER mode.
  // OrdersModule gives us `OrdersService.createForWin`, called inside
  // `close()`'s transaction so the winner's fulfilment order is created
  // atomically with the auction's ENDED flip.
  imports: [NotificationsModule, BidsModule, OrdersModule],
  controllers: [AuctionsController],
  providers: [AuctionsService, AuctionScheduler],
  exports: [AuctionsService],
})
export class AuctionsModule {}
