import { Module } from '@nestjs/common';
import { AuctionsModule } from '../auctions/auctions.module';
import { CoinPacksModule } from '../coin-packs/coin-packs.module';
import { AviatorModule } from '../aviator/aviator.module';
import { AdminController } from './admin.controller';
import { AuditController } from './audit.controller';
import { AdminRolesController } from './roles.controller';
import { SettingsController } from './settings.controller';
import { FeatureFlagsController } from './feature-flags.controller';
import { PermsGuard } from './perms.guard';

@Module({
  imports: [AuctionsModule, CoinPacksModule, AviatorModule],
  controllers: [
    AdminController,
    AuditController,
    AdminRolesController,
    SettingsController,
    FeatureFlagsController,
  ],
  providers: [PermsGuard],
})
export class AdminModule {}
