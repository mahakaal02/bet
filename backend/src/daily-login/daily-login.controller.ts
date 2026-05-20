import {
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { DailyLoginService } from './daily-login.service';

/**
 * Daily-login streak endpoints (Roadmap §F-USER-8).
 *
 *   GET  /me/daily-login        — state + today's reward preview
 *   POST /me/daily-login/claim  — claim today's reward
 *
 * `claim` is throttled at 5/min/IP — the unique constraint on
 * `(userId, claimDateUtc)` is the real defence, but the throttle
 * stops a buggy client from hammering the wallet host during a
 * partial-failure replay loop.
 */
@UseGuards(JwtAuthGuard)
@Controller('me/daily-login')
export class DailyLoginController {
  constructor(private readonly daily: DailyLoginService) {}

  @Get()
  state(@CurrentUser() user: AuthedUser) {
    return this.daily.getState(user.id);
  }

  @Throttle({ daily_claim: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('claim')
  claim(@CurrentUser() user: AuthedUser) {
    return this.daily.claim(user.id);
  }
}
