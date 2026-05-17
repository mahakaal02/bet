import { Global, Module } from '@nestjs/common';
import { CoinSettingsService } from './coin-settings.service';

@Global()
@Module({
  providers: [CoinSettingsService],
  exports: [CoinSettingsService],
})
export class CoinsModule {}
