import { Module } from '@nestjs/common';
import { BetWalletModule } from '../bet-wallet/bet-wallet.module';
import { DailyLoginController } from './daily-login.controller';
import { DailyLoginService } from './daily-login.service';

/**
 * Daily-login streak module — REST endpoints + service. Settings
 * + notification services come in via the @Global FoundationModule.
 */
@Module({
  imports: [BetWalletModule],
  controllers: [DailyLoginController],
  providers: [DailyLoginService],
  exports: [DailyLoginService],
})
export class DailyLoginModule {}
