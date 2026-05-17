import { Module } from '@nestjs/common';
import { CoinPacksModule } from '../coin-packs/coin-packs.module';
import { BetWalletModule } from '../bet-wallet/bet-wallet.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { RazorpayClient } from './razorpay.client';
import { WalletController } from './wallet.controller';

@Module({
  imports: [CoinPacksModule, BetWalletModule],
  controllers: [PaymentsController, WalletController],
  providers: [PaymentsService, RazorpayClient],
  exports: [PaymentsService],
})
export class PaymentsModule {}
