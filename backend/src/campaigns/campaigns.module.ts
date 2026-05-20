import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FoundationModule } from '../foundation/foundation.module';
import { PromoCodesService } from './promo-codes.service';
import { PromoCodesController } from './promo-codes.controller';
import { PromoCodesAdminController } from './promo-codes-admin.controller';

@Module({
  imports: [PrismaModule, FoundationModule],
  controllers: [PromoCodesController, PromoCodesAdminController],
  providers: [PromoCodesService],
  exports: [PromoCodesService],
})
export class CampaignsModule {}
