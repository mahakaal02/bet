import { Module } from '@nestjs/common';
import { BetWalletModule } from '../bet-wallet/bet-wallet.module';
import { PaymentsService } from './payments.service';
import { WalletController } from './wallet.controller';

/**
 * Payments module — post-Razorpay.
 *
 * Now just exposes `GET /wallet/balance` (a Bet-wallet balance read).
 * The Razorpay client, the deprecated `/payments/*` controller, and
 * the order/verify endpoints were removed when Razorpay was retired.
 */
@Module({
  imports: [BetWalletModule],
  controllers: [WalletController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
