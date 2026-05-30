import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BetWalletModule } from '../bet-wallet/bet-wallet.module';
import { ResponsibleGamblingModule } from '../responsible-gambling/responsible-gambling.module';
import { FraudModule } from '../fraud/fraud.module';
import { BidsController } from './bids.controller';
import { MeBidsController } from './me-bids.controller';
import { BidsService } from './bids.service';
import { BidGateway } from './bid.gateway';
import { BidEventsService } from './bid-events.service';

@Module({
  imports: [AuthModule, BetWalletModule, ResponsibleGamblingModule, FraudModule],
  controllers: [BidsController, MeBidsController],
  providers: [BidsService, BidGateway, BidEventsService],
  exports: [BidsService, BidEventsService],
})
export class BidsModule {}
