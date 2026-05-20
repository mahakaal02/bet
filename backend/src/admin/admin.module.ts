import { Module } from '@nestjs/common';
import { AuctionsModule } from '../auctions/auctions.module';
import { CoinPacksModule } from '../coin-packs/coin-packs.module';
import { AviatorModule } from '../aviator/aviator.module';
import { AdminController } from './admin.controller';
import { AuditController } from './audit.controller';

@Module({
  imports: [AuctionsModule, CoinPacksModule, AviatorModule],
  controllers: [AdminController, AuditController],
})
export class AdminModule {}
