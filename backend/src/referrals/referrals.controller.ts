import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, Length } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { ReferralsService } from './referrals.service';

/**
 * Authenticated referral endpoints (Roadmap §F-USER-4).
 *
 *   GET  /me/referrals          — code + counts + total earned
 *   POST /me/referrals/claim    — bind to a referrer (post-signup
 *                                  catch-up for users who didn't
 *                                  supply a code at signup time)
 *
 * Signup-path qualification gates (KYC + first deposit) call
 * `ReferralsService.maybeQualify()` from their own services; the
 * REST surface here is user-facing only.
 */

class ClaimDto {
  @IsString() @Length(4, 16)
  code!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('me/referrals')
export class ReferralsController {
  constructor(private readonly svc: ReferralsService) {}

  @Get()
  async summary(@CurrentUser() user: AuthedUser) {
    return this.svc.getMyReferrals(user.id);
  }

  /**
   * Post-signup catch-up — a user who didn't enter a referral code
   * at registration can still bind to one here. Locked once it's
   * been set (one-shot).
   *
   * Throttled tight: brute-forcing codes is a real concern given
   * the alphabet is 32^8 ≈ 1e12, attacker would need many guesses
   * but cheap-rate-limit is still wise.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('claim')
  async claim(@CurrentUser() user: AuthedUser, @Body() dto: ClaimDto) {
    return this.svc.claim({
      refereeUserId: user.id,
      code: dto.code,
    });
  }
}
