import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { BidsService } from './bids.service';

/**
 * `GET /me/bids` (PR-MY-BIDS) — the signed-in user's bid history across
 * every auction, each row carrying the status snapshot from placement
 * time, the live present status, and the auction's status. Backs the
 * "My bids" tab on the auctions hub.
 */
@UseGuards(JwtAuthGuard)
@Controller('me')
export class MeBidsController {
  constructor(private readonly bids: BidsService) {}

  @Get('bids')
  list(@CurrentUser() user: AuthedUser) {
    return this.bids.listUserBids(user.id);
  }
}
