import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuctionsController } from './auctions.controller';
import { AuctionsService } from './auctions.service';
import { AuctionScheduler } from './auction-scheduler';

@Module({
  imports: [NotificationsModule],
  controllers: [AuctionsController],
  providers: [AuctionsService, AuctionScheduler],
  exports: [AuctionsService],
})
export class AuctionsModule {}
