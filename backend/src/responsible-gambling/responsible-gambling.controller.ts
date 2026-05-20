import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  IsIn,
  IsInt,
  IsOptional,
  Min,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { ResponsibleGamblingService } from './responsible-gambling.service';

/**
 * Authenticated RG endpoints (Roadmap §F-USER-14).
 *
 *   GET  /me/rg-profile                 — limits + cooldown / exclusion state
 *   PATCH /me/rg-profile                — update one or more limits
 *                                          (lower=instant, raise=refused)
 *   POST /me/rg/cooldown { duration }   — start a voluntary cool-down
 *   POST /me/rg/self-exclude { duration } — start a self-exclusion
 *                                            (24h / 7d / 30d / 90d / perm)
 *   GET  /me/rg/events                  — forensic event log
 *
 * The cooldown / self-exclude endpoints intentionally do NOT support
 * cancellation — that's regulatory. If a user changes their mind they
 * wait it out (or contact support after the period for permanent
 * cases).
 */

class UpdateLimitsDto {
  @IsOptional() @IsInt() @Min(0) dailyDepositLimitCoins?: number | null;
  @IsOptional() @IsInt() @Min(0) weeklyDepositLimitCoins?: number | null;
  @IsOptional() @IsInt() @Min(0) monthlyDepositLimitCoins?: number | null;
  @IsOptional() @IsInt() @Min(0) dailyLossLimitCoins?: number | null;
  @IsOptional() @IsInt() @Min(0) weeklyLossLimitCoins?: number | null;
  @IsOptional() @IsInt() @Min(0) monthlyLossLimitCoins?: number | null;
  @IsOptional() @IsInt() @Min(0) dailyWagerLimitCoins?: number | null;
  @IsOptional() @IsInt() @Min(5) sessionReminderMinutes?: number;
}

class CooldownDto {
  @IsIn(['day1', 'day7', 'day30', 'day90'])
  duration!: 'day1' | 'day7' | 'day30' | 'day90';
}

class SelfExcludeDto {
  @IsIn(['day7', 'day30', 'day90', 'permanent'])
  duration!: 'day7' | 'day30' | 'day90' | 'permanent';
}

@UseGuards(JwtAuthGuard)
@Controller()
export class ResponsibleGamblingController {
  constructor(private readonly rg: ResponsibleGamblingService) {}

  @Get('me/rg-profile')
  async profile(@CurrentUser() user: AuthedUser) {
    const row = await this.rg.getProfile(user.id);
    return {
      ...row,
      cooldownUntil: row.cooldownUntil?.toISOString() ?? null,
      selfExcludedUntil: row.selfExcludedUntil?.toISOString() ?? null,
      selfExcludedAt: row.selfExcludedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  @Throttle({ rg_limits: { limit: 5, ttl: 60_000 } })
  @Patch('me/rg-profile')
  async updateLimits(
    @CurrentUser() user: AuthedUser,
    @Body() dto: UpdateLimitsDto,
  ) {
    const row = await this.rg.updateLimits(user.id, dto);
    return {
      ...row,
      cooldownUntil: row.cooldownUntil?.toISOString() ?? null,
      selfExcludedUntil: row.selfExcludedUntil?.toISOString() ?? null,
      selfExcludedAt: row.selfExcludedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  @Throttle({ rg_cooldown: { limit: 3, ttl: 60_000 } })
  @HttpCode(200)
  @Post('me/rg/cooldown')
  async cooldown(
    @CurrentUser() user: AuthedUser,
    @Body() dto: CooldownDto,
  ) {
    const row = await this.rg.startCooldown(user.id, dto.duration);
    return {
      cooldownUntil: row.cooldownUntil?.toISOString() ?? null,
    };
  }

  @Throttle({ rg_self_exclude: { limit: 3, ttl: 60_000 } })
  @HttpCode(200)
  @Post('me/rg/self-exclude')
  async selfExclude(
    @CurrentUser() user: AuthedUser,
    @Body() dto: SelfExcludeDto,
  ) {
    const row = await this.rg.startSelfExclusion(user.id, dto.duration);
    return {
      selfExcludedAt: row.selfExcludedAt?.toISOString() ?? null,
      selfExcludedUntil: row.selfExcludedUntil?.toISOString() ?? null,
    };
  }

  @Get('me/rg/events')
  events(
    @CurrentUser() user: AuthedUser,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limit = Math.max(1, Math.min(200, Number(limitRaw) || 50));
    return this.rg.listEvents(user.id, limit, cursor);
  }
}
