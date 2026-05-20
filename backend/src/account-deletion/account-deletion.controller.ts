import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { AccountDeletionService } from './account-deletion.service';

/**
 * Authenticated deletion + export endpoints. Roadmap §F-USER-12.
 *
 *   GET  /me/account-deletion        — { pending, daysRemaining? }
 *   POST /me/account-deletion        — { reason? } start 30-day cool-off
 *   POST /me/account-deletion/cancel — restore the account
 *   POST /me/data-export             — download a JSON bundle
 *
 * No /admin/account-deletion/:id/purge here — that runs from a cron
 * in PR-DELETION-2 (or via the admin SPA's user-detail page) and
 * needs RBAC scoping. Keeping it out of this PR keeps scope tight.
 */

class RequestDeletionDto {
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

@UseGuards(JwtAuthGuard)
@Controller()
export class AccountDeletionController {
  constructor(private readonly service: AccountDeletionService) {}

  @Get('me/account-deletion')
  status(@CurrentUser() user: AuthedUser) {
    return this.service.status(user.id);
  }

  @Throttle({ acct_del_request: { limit: 3, ttl: 60_000 } })
  @HttpCode(200)
  @Post('me/account-deletion')
  request(
    @CurrentUser() user: AuthedUser,
    @Body() dto: RequestDeletionDto,
  ) {
    return this.service.request(user.id, dto.reason);
  }

  @Throttle({ acct_del_cancel: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('me/account-deletion/cancel')
  cancel(@CurrentUser() user: AuthedUser) {
    return this.service.cancel(user.id);
  }

  /**
   * GDPR/DPDP data export. Returns a JSON file as an attachment so
   * the browser triggers a download. Synchronous — the per-user
   * dataset fits in memory at our scale.
   *
   * Throttled at 1/min/user because each export touches ~12
   * tables; the rate-limit is the only thing that stops a malicious
   * tab from holding the DB busy by spamming the endpoint.
   */
  @Throttle({ data_export: { limit: 1, ttl: 60_000 } })
  @HttpCode(200)
  @Header('Content-Type', 'application/json')
  @Post('me/data-export')
  async exportData(
    @CurrentUser() user: AuthedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.service.exportData(user.id);
    const filename = `kalki-data-export-${user.username}-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    return data;
  }
}
