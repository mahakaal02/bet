import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BetWalletModule } from '../bet-wallet/bet-wallet.module';
import { AviatorController } from './aviator.controller';
import { PublicAviatorController } from './public-aviator.controller';
import { AviatorService } from './aviator.service';
import { FairnessStore } from './fairness-store';
import { AviatorChatService } from './chat.service';
import { CrashDistributionService } from './crash/crash-distribution.service';

@Module({
  imports: [AuthModule, BetWalletModule],
  // `PublicAviatorController` (`/aviator/public/*`) is the
  // anonymous-readable surface — last-crash multiplier, eventually
  // round-count / live-payouts. Registered alongside the JWT-guarded
  // `AviatorController` rather than via `@Public()` because the
  // class-level guard on `AviatorController` doesn't compose with a
  // per-method opt-out. See PublicAviatorController docstring.
  controllers: [AviatorController, PublicAviatorController],
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
