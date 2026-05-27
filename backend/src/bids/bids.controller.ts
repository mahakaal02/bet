import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { BidsService } from './bids.service';
import { BidEventsService } from './bid-events.service';
import { PlaceBidDto } from './dto/bid.dto';
import { DenyImpersonated } from '../foundation/decorators/deny-impersonated.decorator';

@UseGuards(JwtAuthGuard)
@Controller('auctions/:auctionId')
export class BidsController {
  constructor(
    private readonly bids: BidsService,
    private readonly events: BidEventsService,
  ) {}

  // Anti-spam: max 5 placements per 10s per IP. Combined with the per-user
  // FOR UPDATE row lock in BidsService.placeBid, this prevents flooding
  // even before the DB sees the request.
  // Placement spends real coins; an impersonating admin must not do
  // it on the user's behalf (PR-ARCH-AUDIT, Stage A).
  @DenyImpersonated()
  @Throttle({ bid: { limit: 5, ttl: 10_000 } })
  @Post('bids')
  async place(
    @Param('auctionId') auctionId: string,
    @Body() dto: PlaceBidDto,
    @CurrentUser() user: AuthedUser,
  ) {
    const bid = await this.bids.placeBid(user.id, auctionId, dto.amount);
    await this.events.broadcastBidPlaced(auctionId, user.id);
    return { id: bid.id, amount: bid.amount.toString(), placedAt: bid.createdAt };
  }
}
