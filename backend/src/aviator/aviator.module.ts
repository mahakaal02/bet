import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BetWalletModule } from '../bet-wallet/bet-wallet.module';
import { AviatorController } from './aviator.controller';
import { AviatorService } from './aviator.service';
import { FairnessStore } from './fairness-store';
import { AviatorChatService } from './chat.service';
import { CrashDistributionService } from './crash/crash-distribution.service';

@Module({
  imports: [AuthModule, BetWalletModule],
  controllers: [AviatorController],
  providers: [
    AviatorService,
    FairnessStore,
    AviatorChatService,
    CrashDistributionService,
  ],
  exports: [
    AviatorService,
    FairnessStore,
    AviatorChatService,
    CrashDistributionService,
  ],
})
export class AviatorModule {}
