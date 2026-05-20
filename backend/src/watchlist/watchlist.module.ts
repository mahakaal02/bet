import { Module } from '@nestjs/common';
import { WatchlistController } from './watchlist.controller';
import { WatchlistService } from './watchlist.service';

/**
 * Watchlist module — REST surface for the "★ Watch" affordance.
 * `Watchlist` schema + the read-side consumer (outbid listener)
 * already shipped with the Foundation PR + PR-NOTIFY-1; this module
 * is the write-side completion of that pipeline.
 */
@Module({
  controllers: [WatchlistController],
  providers: [WatchlistService],
  exports: [WatchlistService],
})
export class WatchlistModule {}
