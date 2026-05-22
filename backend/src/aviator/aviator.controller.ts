import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AviatorService } from './aviator.service';
import { FairnessStore } from './fairness-store';
import { AviatorChatService } from './chat.service';
import { PlaceAviatorBetDto, SendChatMessageDto } from './dto/aviator.dto';

@UseGuards(JwtAuthGuard)
@Controller('aviator')
export class AviatorController {
  constructor(
    private readonly aviator: AviatorService,
    private readonly fairness: FairnessStore,
    private readonly chat: AviatorChatService,
  ) {}

  @Get('balance')
  async balance(@CurrentUser() user: AuthedUser) {
    return { demoBalance: await this.aviator.getBalance(user.id) };
  }

  @Throttle({ bid: { limit: 5, ttl: 10_000 } })
  @Post('bet')
  async placeBet(@CurrentUser() user: AuthedUser, @Body() dto: PlaceAviatorBetDto) {
    return this.aviator.placeBet(
      user.id,
      user.username,
      dto.amount,
      dto.autoCashoutAt ?? null,
    );
  }

  @Throttle({ bid: { limit: 10, ttl: 10_000 } })
  @Post('cashout')
  async cashout(@CurrentUser() user: AuthedUser) {
    return this.aviator.cashout(user.id);
  }

  @Get('history')
  async history(@Query('limit') limit?: string) {
    const n = Math.min(100, Math.max(1, Number(limit) || 20));
    return this.aviator.recentRounds(n);
  }

  /**
   * Player's own performance stats over a rolling window. Backs the
   * "My stats" modal in the player UI — Day / Week / Month / All
   * tabs each hit this endpoint with the corresponding range.
   *
   * Unknown / missing `range` falls back to "day" rather than 400ing,
   * so a typo in the URL still produces a usable readout.
   */
  @Get('stats')
  async stats(
    @CurrentUser() user: AuthedUser,
    @Query('range') range?: string,
  ) {
    const r =
      range === 'week' || range === 'month' || range === 'all'
        ? range
        : 'day';
    return this.aviator.getUserStats(user.id, r);
  }

  @Get('fairness/current')
  async fairnessCurrent() {
    return this.fairness.currentPublic();
  }

  @Get('fairness/seeds')
  async fairnessSeeds(@Query('limit') limit?: string) {
    const n = Math.min(100, Math.max(1, Number(limit) || 20));
    return this.fairness.listRevealed(n);
  }

  @Get('chat')
  async chatHistory(@Query('limit') limit?: string) {
    const n = Math.min(200, Math.max(1, Number(limit) || 50));
    return this.chat.recent(n);
  }

  @Post('chat')
  async sendChat(@CurrentUser() user: AuthedUser, @Body() dto: SendChatMessageDto) {
    // REST fallback so non-socket clients (admin tools, scripts) can post too.
    return this.chat.send(user.id, user.username, dto.message);
  }
}
