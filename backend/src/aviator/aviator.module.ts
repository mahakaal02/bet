import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BetWalletModule } from '../bet-wallet/bet-wallet.module';
import { AviatorController } from './aviator.controller';
import { PublicAviatorController } from './public-aviator.controller';
import { AviatorService } from './aviator.service';
import { AviatorState } from './aviator-state';
import { AviatorGateway } from './aviator.gateway';
import { AviatorKnobsService } from './aviator-knobs.service';
import { BetSettlementService } from './bet-settlement.service';
import { RoundLifecycleService } from './round-lifecycle.service';
import { AviatorAnalyticsService } from './aviator-analytics.service';
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
  // per-method opt-out.
  controllers: [AviatorController, PublicAviatorController],
  providers: [
    // Aviator was split out of a single 1,412-LOC service (PR-ARCH-AUDIT,
    // Stage B). Registration order doesn't matter for Nest DI but is
    // grouped here in dependency order to make the design obvious:
    //   State ← leaf
    //   Knobs, Gateway, Analytics ← depend on State (+ Prisma / IO)
    //   Settlement ← depends on State + Gateway
    //   Lifecycle  ← depends on everything above
    //   AviatorService ← composition root, delegates to all sub-services
    AviatorState,
    FairnessStore,
    AviatorChatService,
    CrashDistributionService,
    AviatorKnobsService,
    AviatorGateway,
    AviatorAnalyticsService,
    BetSettlementService,
    RoundLifecycleService,
    AviatorService,
  ],
  exports: [
    AviatorService,
    FairnessStore,
    AviatorChatService,
    CrashDistributionService,
  ],
})
export class AviatorModule {}
