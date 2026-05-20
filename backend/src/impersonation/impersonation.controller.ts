import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { Perm } from '../admin/perms.guard';
import { ImpersonationService } from './impersonation.service';

/**
 * Admin impersonation surface. Mounted under `/admin/impersonate`
 * so the existing admin RBAC tooling (PermsGuard) governs access.
 *
 *   POST /admin/impersonate         — { userId, reason } → token
 *   POST /admin/impersonate/:id/end — close the row
 *   GET  /admin/impersonate         — log (cursor pagination)
 *
 * Permission slug: `'user.view'` for the read endpoint, and a
 * dedicated `'user.impersonate'` slug for start/end. The slug isn't
 * yet in the ROLE_PERMISSIONS matrix — for this PR we lean on the
 * legacy `isAdmin: true` backstop that PermsGuard already honours.
 * Adding the slug to the matrix is a one-line follow-up once the
 * MODERATOR role gets the privilege (or doesn't — that's a policy
 * call for the operations team).
 */

class StartDto {
  @IsString() @MinLength(1) @MaxLength(64)
  userId!: string;

  @IsString() @MinLength(10) @MaxLength(500)
  reason!: string;
}

@Controller('admin/impersonate')
export class ImpersonationController {
  constructor(private readonly service: ImpersonationService) {}

  @Throttle({ impersonate_start: { limit: 6, ttl: 60_000 } })
  @Perm('user.view')
  @HttpCode(200)
  @Post()
  async start(
    @CurrentUser() admin: AuthedUser,
    @Body() dto: StartDto,
    @Req() req: {
      headers: Record<string, string | string[] | undefined>;
      ip?: string;
    },
  ) {
    return this.service.start({
      admin,
      targetUserId: dto.userId,
      reason: dto.reason,
      ipAddress: extractIp(req),
      userAgent: pickHeader(req, 'user-agent') ?? undefined,
    });
  }

  @Throttle({ impersonate_end: { limit: 30, ttl: 60_000 } })
  @Perm('user.view')
  @HttpCode(200)
  @Post(':id/end')
  end(
    @CurrentUser() admin: AuthedUser,
    @Param('id') impersonationId: string,
  ) {
    return this.service.end(admin.id, impersonationId);
  }

  @Perm('audit.view')
  @Get()
  list(
    @Query('adminId') adminId?: string,
    @Query('userId') userId?: string,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limit = Math.max(1, Math.min(100, Number(limitRaw) || 50));
    return this.service.list({ adminId, userId, limit, cursor });
  }
}

function extractIp(req: {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}): string | undefined {
  const xff = req.headers['x-forwarded-for'];
  if (Array.isArray(xff)) return xff[0]?.split(',')[0]?.trim();
  if (typeof xff === 'string') return xff.split(',')[0]?.trim();
  return req.ip;
}

function pickHeader(
  req: { headers: Record<string, string | string[] | undefined> },
  name: string,
): string | null {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}
