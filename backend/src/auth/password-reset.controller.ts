import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { PasswordResetService } from './password-reset.service';

/**
 * Password-reset HTTP surface — see `password-reset.service.ts` for
 * the flow and Roadmap §F-USER-10 for the design.
 *
 * Two endpoints:
 *
 *   POST /auth/password-reset/request  { email }
 *     → 200 always. The body the user sees is identical whether or
 *       not the email exists, so an attacker can't enumerate accounts.
 *       The service throttles per-email + per-IP internally.
 *
 *   POST /auth/password-reset/confirm  { token, newPassword }
 *     → 200 on success. 400 on bad token / expired / used / too-short
 *       password (combined into a single message so the attacker can't
 *       differentiate the failure modes).
 *
 * The endpoints are also throttled at the HTTP layer (5/min/IP each)
 * as a second line of defence — the service's per-hour limits stop
 * sustained abuse; the per-minute limits stop bursts.
 */

class RequestResetDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(320)
  email!: string;
}

class ConfirmResetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}

@Controller('auth/password-reset')
export class PasswordResetController {
  constructor(private readonly service: PasswordResetService) {}

  @Throttle({ pwreset_request: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('request')
  async request(
    @Body() dto: RequestResetDto,
    @Req() req: { headers: Record<string, string | string[] | undefined>; ip?: string },
  ): Promise<{ ok: true }> {
    await this.service.request({
      email: dto.email,
      ip: extractIp(req),
    });
    // Always 200, always the same body. Account-enumeration resistance.
    return { ok: true };
  }

  @Throttle({ pwreset_confirm: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('confirm')
  async confirm(@Body() dto: ConfirmResetDto): Promise<{ ok: true }> {
    await this.service.confirm({
      token: dto.token,
      newPassword: dto.newPassword,
    });
    return { ok: true };
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
