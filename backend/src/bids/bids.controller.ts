import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { BidsService } from './bids.service';
import { BidEventsService } from './bid-events.service';
import { PlaceBidDto } from './dto/bid.dto';

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
