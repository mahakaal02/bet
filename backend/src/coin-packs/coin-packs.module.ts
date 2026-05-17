import { Module } from '@nestjs/common';
import { CoinPacksController } from './coin-packs.controller';
import { CoinPacksService } from './coin-packs.service';

@Module({
  controllers: [CoinPacksController],
  providers: [CoinPacksService],
  exports: [CoinPacksService],
})
export class CoinPacksModule {}
