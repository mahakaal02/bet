import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, AuthedUser } from './current-user.decorator';
import { BetWalletService } from '../bet-wallet/bet-wallet.service';

class Login2FADto {
  @IsString() @MinLength(1) @MaxLength(1024)
  challengeToken!: string;

  @IsString() @MinLength(1) @MaxLength(32)
  code!: string;

  @IsOptional() @IsBoolean()
  trustDevice?: boolean;
}

/** Header carrying the trusted-device cookie token — the auctions
 *  Next.js proxy reads the httpOnly cookie from the browser and forwards
 *  it as this header. Keeps cookie-handling responsibility on the proxy
 *  (where the Next.js cookies() helper lives) while letting the Nest
 *  backend stay cookie-agnostic. */
const TRUSTED_DEVICE_HEADER = 'x-kalki-trusted-device';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly betWallet: BetWalletService,
  ) {}

  // Register is rate-limited harder than login because every successful
  // call materialises a new account row + idempotent wallet ensure on
  // Bet — a flood of registrations grinds the wallet host more than a
  // login bcrypt-CPU spike does.
  @Throttle({ register: { limit: 3, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  // Login throttle: 8 attempts per minute per IP. Pairs with the
  // bcrypt CPU cost (~80 ms/check at rounds=10) to give a worst-case
  // ~640 ms of work per attacker IP per minute — slow enough that an
  // online brute-force against an 8-char alphanum password would take
  // ~10^15 IP-minutes. Layer with the existing global throttler.
  @Throttle({ login: { limit: 8, ttl: 60_000 } })
  @Post('login')
  login(
    @Body() dto: LoginDto,
    @Headers(TRUSTED_DEVICE_HEADER) trustedDeviceToken?: string,
  ) {
    return this.auth.login(dto, trustedDeviceToken ?? null);
  }

  /**
   * Step 2 of the 2FA login. The client receives `{ needs2FA: true,
   * challengeToken }` from /auth/login when the account has 2FA
   * enabled and finishes the dance here with the 6-digit TOTP code
   * or an 8-char backup code. Returns the standard
   * `{ token, user }` on success.
   *
   * Throttle is tighter than the password login: the password step
   * already gated the attempt, and the per-user TOTP lockout in
   * `TwoFactorService` covers the per-user dimension — this throttle
   * is the per-IP belt.
   */
  @Throttle({ login_2fa: { limit: 8, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login/2fa')
  loginTwoFactor(
    @Body() dto: Login2FADto,
    @Headers('user-agent') userAgent?: string,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    return this.auth.completeLoginWith2FA({
      challengeToken: dto.challengeToken,
      code: dto.code,
      trustDevice: dto.trustDevice,
      userAgent: userAgent ?? null,
      acceptLanguage: acceptLanguage ?? null,
    });
  }

  /**
   * Whoami. Overrides `coinBalance` with the live Bet wallet balance so
   * the Android app shows the unified number (not the now-stale local
   * column). Falls back to the local column if Bet is unreachable — the
   * UI still lights up with the last-known balance under degradation
   * rather than zero.
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: AuthedUser): Promise<AuthedUser> {
    if (!this.betWallet.isConfigured()) return user;
    try {
      const balance = await this.betWallet.balance(user.id);
      return { ...user, coinBalance: balance };
    } catch (err) {
      this.logger.warn(
        `/auth/me: Bet balance fetch failed for ${user.id}, falling back to local column: ${
          err instanceof Error ? err.message : err
        }`,
      );
      return user;
    }
  }
}
