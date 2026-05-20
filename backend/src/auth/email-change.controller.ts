import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthedUser, CurrentUser } from './current-user.decorator';
import { EmailChangeService } from './email-change.service';

/**
 * Email-change HTTP surface (Roadmap §F-USER-11).
 *
 *   GET  /me/email-change                — pending request state (or null)
 *   POST /me/email-change/request        — { newEmail, password }
 *   POST /me/email-change/cancel         — cancel an in-flight request
 *
 *   POST /auth/email-change/confirm      — { token } — UNAUTHED
 *                                          (the link is clicked from
 *                                          an inbox, no session
 *                                          context). The token IS
 *                                          the auth — a 32-byte
 *                                          random secret only the
 *                                          target inbox controls.
 *
 * Throttling tops the per-user rate limit in the service. The
 * confirm endpoint is intentionally throttled higher than request —
 * legitimate users may double-click links.
 */

class RequestChangeDto {
  @IsEmail({}, { message: 'newEmail must be a valid email address' })
  @MaxLength(320)
  newEmail!: string;

  @IsString() @MinLength(1) @MaxLength(128)
  password!: string;
}

class ConfirmChangeDto {
  @IsString() @MinLength(1) @MaxLength(256)
  token!: string;
}

@Controller()
export class EmailChangeController {
  constructor(private readonly service: EmailChangeService) {}

  // ─── Authed: status / request / cancel ──────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('me/email-change')
  pending(@CurrentUser() user: AuthedUser) {
    return this.service.pending(user.id).then((p) => p ?? { pending: null });
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ email_change_request: { limit: 3, ttl: 60_000 } })
  @HttpCode(200)
  @Post('me/email-change/request')
  async request(
    @CurrentUser() user: AuthedUser,
    @Body() dto: RequestChangeDto,
    @Req() req: {
      headers: Record<string, string | string[] | undefined>;
      ip?: string;
    },
  ) {
    await this.service.request({
      userId: user.id,
      newEmail: dto.newEmail,
      password: dto.password,
      ip: extractIp(req),
    });
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('me/email-change/cancel')
  async cancel(@CurrentUser() user: AuthedUser) {
    return this.service.cancel(user.id);
  }

  // ─── Unauthed: confirm (the token IS the auth) ──────────────────

  @Throttle({ email_change_confirm: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('auth/email-change/confirm')
  async confirm(@Body() dto: ConfirmChangeDto) {
    return this.service.confirm(dto.token);
  }
}

function extractIp(req: {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (Array.isArray(xff)) return xff[0]?.split(',')[0]?.trim() ?? null;
  if (typeof xff === 'string') return xff.split(',')[0]?.trim() ?? null;
  return req.ip ?? null;
}
