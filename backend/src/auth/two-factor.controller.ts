import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthedUser, CurrentUser } from './current-user.decorator';
import { TwoFactorService } from './two-factor.service';
import { DenyImpersonated } from '../foundation/decorators/deny-impersonated.decorator';

/**
 * Authenticated 2FA endpoints (Roadmap §F-USER-9). The intermediate
 * login-challenge endpoint lives in `auth.controller.ts` because it's
 * the only 2FA endpoint that's reached WITHOUT a session — the rest
 * are post-login account-management surfaces.
 *
 *   GET  /me/2fa/status                — { enrolled, enabled, ... }
 *   POST /me/2fa/enroll                — start enrollment, returns QR + codes
 *   POST /me/2fa/verify  { code }      — confirm first code, enable 2FA
 *   POST /me/2fa/disable { password, code } — turn 2FA off
 *   POST /me/2fa/backup-codes/regenerate — replace the 10 backup codes
 *
 * Every mutating endpoint is throttled per-IP (10/min) — defence in
 * depth on top of the per-user lockout the service maintains.
 */

class CodeDto {
  @IsString() @MinLength(1) @MaxLength(32)
  code!: string;
}

class DisableDto {
  @IsString() @MinLength(1) @MaxLength(128)
  password!: string;

  @IsString() @MinLength(1) @MaxLength(32)
  code!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('me/2fa')
export class TwoFactorController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  @Get('status')
  status(@CurrentUser() user: AuthedUser) {
    return this.twoFactor.status(user.id);
  }

  // 2FA mutations change the user's auth posture; an impersonating
  // admin must NOT be able to enroll, verify, disable, or rotate
  // backup codes (PR-ARCH-AUDIT, Stage A). Status read is allowed.
  @DenyImpersonated()
  @Throttle({ '2fa_enroll': { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('enroll')
  enroll(@CurrentUser() user: AuthedUser) {
    const label = user.email ?? user.username;
    return this.twoFactor.beginEnrollment(user.id, label);
  }

  @DenyImpersonated()
  @Throttle({ '2fa_verify': { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('verify')
  async verify(
    @CurrentUser() user: AuthedUser,
    @Body() dto: CodeDto,
  ): Promise<{ ok: true }> {
    await this.twoFactor.verifyEnrollment(user.id, dto.code);
    return { ok: true };
  }

  @DenyImpersonated()
  @Throttle({ '2fa_disable': { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('disable')
  async disable(
    @CurrentUser() user: AuthedUser,
    @Body() dto: DisableDto,
  ): Promise<{ ok: true }> {
    await this.twoFactor.disable(user.id, dto.password, dto.code);
    return { ok: true };
  }

  @DenyImpersonated()
  @Throttle({ '2fa_codes': { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('backup-codes/regenerate')
  regenerateBackupCodes(@CurrentUser() user: AuthedUser) {
    return this.twoFactor.regenerateBackupCodes(user.id).then((codes) => ({
      backupCodes: codes,
    }));
  }
}
