import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FoundationModule } from '../foundation/foundation.module';
import { ReferralsService } from './referrals.service';
import { ReferralsController } from './referrals.controller';

/**
 * Referral module. Exports `ReferralsService` so KYC + Payments can
 * call `maybeQualify()` after their own success paths complete:
 *
 *   - KycService.recomputeTier()      — call after a promotion ≥ TIER_1
 *   - PaymentsService.finalizeOrder() — call after a successful top-up
 *
 * Module dependencies stay minimal; the outbox lives in FoundationModule
 * (re-exported globally).
 */
@Module({
  imports: [PrismaModule, FoundationModule],
  controllers: [ReferralsController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
