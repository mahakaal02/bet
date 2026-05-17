import { Controller, Get, Param } from '@nestjs/common';
import { AuctionsService } from './auctions.service';

/**
 * Marketplace-listing endpoints — intentionally public. The list of
 * what's-for-auction is advertising, not user-scoped data, and the Bet
 * Next.js webapp at :3100 renders these pages for anonymous visitors
 * (only the bid-placement step at `POST /auctions/:id/bids` requires an
 * authenticated JWT, since that's the gate for spending coins).
 */
@Controller('auctions')
export class AuctionsController {
  constructor(private readonly auctions: AuctionsService) {}

  @Get()
  list() {
    return this.auctions.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.auctions.get(id);
  }
}
