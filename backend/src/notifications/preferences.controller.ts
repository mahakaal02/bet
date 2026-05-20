import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * `NotificationPreference` CRUD for the end user.
 *
 * One row per user (PK = userId). GET returns the row, creating a
 * defaults row on first read so the client always has the canonical
 * shape to render its toggle list against.
 *
 * The `responsibleGambling` channel is non-modifiable from the
 * client (regulatory: limit-reached + cooldown notifications must
 * always send). It's accepted in PATCH for forwards-compatibility
 * but the writer silently coerces it back to `true`.
 */
class UpdatePreferencesDto {
  @IsOptional() @IsBoolean() outbid?: boolean;
  @IsOptional() @IsBoolean() auctionEnding?: boolean;
  @IsOptional() @IsBoolean() orderUpdates?: boolean;
  @IsOptional() @IsBoolean() dailyStreak?: boolean;
  @IsOptional() @IsBoolean() marketingPush?: boolean;
  @IsOptional() @IsBoolean() marketingEmail?: boolean;
}

@UseGuards(JwtAuthGuard)
@Controller('notifications/preferences')
export class NotificationsPreferencesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(@CurrentUser() user: AuthedUser) {
    const existing = await this.prisma.notificationPreference.findUnique({
      where: { userId: user.id },
    });
    if (existing) return existing;
    return this.prisma.notificationPreference.create({
      data: { userId: user.id },
    });
  }

  @Patch()
  @Throttle({ prefs: { limit: 10, ttl: 60_000 } })
  async update(
    @CurrentUser() user: AuthedUser,
    @Body() dto: UpdatePreferencesDto,
  ) {
    // Regulatory: responsibleGambling cannot be turned off through
    // this API. Force-true on every write.
    return this.prisma.notificationPreference.upsert({
      where: { userId: user.id },
      update: { ...dto, responsibleGambling: true },
      create: { userId: user.id, ...dto, responsibleGambling: true },
    });
  }
}
