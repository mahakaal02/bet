import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BetWalletModule } from '../bet-wallet/bet-wallet.module';
import { AviatorController } from './aviator.controller';
import { AviatorService } from './aviator.service';
import { FairnessStore } from './fairness-store';
import { AviatorChatService } from './chat.service';

@Module({
  imports: [AuthModule, BetWalletModule],
  controllers: [AviatorController],
  providers: [AviatorService, FairnessStore, AviatorChatService],
  exports: [AviatorService, FairnessStore, AviatorChatService],
})
export class AviatorModule {}
