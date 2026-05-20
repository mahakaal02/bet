import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { WatchlistService } from './watchlist.service';

/**
 * Watchlist HTTP surface (Roadmap §F-USER-1).
 *
 *   POST   /auctions/:id/watch    → { watching: true,  since, alreadyWatching }
 *   DELETE /auctions/:id/watch    → { watching: false, removed }
 *   GET    /me/watchlist          → { items: [...], counts: {...} }
 *
 * All endpoints require an authenticated user — the watchlist is a
 * per-user concept, never anonymous. The `watchlist.enabled` feature
 * flag is enforced one level down in the service, so flipping the
 * flag instantly closes the surface without touching this file.
 *
 * Note on routing: the watch/unwatch verbs hang off the auctions
 * collection path so they sit next to the existing auction handlers
 * — easier to grep, easier for an auction-context client to call.
 * The list endpoint lives under `/me/*` because it's user-scoped.
 */
@UseGuards(JwtAuthGuard)
@Controller()
export class WatchlistController {
  constructor(private readonly watchlist: WatchlistService) {}

  @Post('auctions/:id/watch')
  async watch(
    @Param('id') auctionId: string,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.watchlist.watch(user.id, auctionId);
  }

  @Delete('auctions/:id/watch')
  async unwatch(
    @Param('id') auctionId: string,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.watchlist.unwatch(user.id, auctionId);
  }

  @Get('me/watchlist')
  async list(@CurrentUser() user: AuthedUser) {
    return this.watchlist.listForUser(user.id);
  }
}
