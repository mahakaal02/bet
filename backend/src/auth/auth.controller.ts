import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, AuthedUser } from './current-user.decorator';
import { BetWalletService } from '../bet-wallet/bet-wallet.service';
import {
  AdminCookieOptions,
  serializeAdminCookie,
  serializeAdminCookieClear,
} from './cookie';

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
    private readonly config: ConfigService,
  ) {}

  /**
   * Cookie options for the admin session. Reads:
   *   - `ADMIN_COOKIE_SECURE` (default: true in non-development)
   *   - `ADMIN_COOKIE_DOMAIN` (optional, e.g. `.cloud.podstack.ai`)
   *   - `ADMIN_COOKIE_MAX_AGE_SECONDS` (default: 43200 = 12h)
   */
  private adminCookieOptions(): AdminCookieOptions {
    const env = (this.config.get<string>('NODE_ENV') ?? 'development').toLowerCase();
    const secureDefault = env !== 'development' && env !== 'test';
    const secureOverride = this.config.get<string>('ADMIN_COOKIE_SECURE');
    const secure = secureOverride
      ? secureOverride.toLowerCase() === 'true' || secureOverride === '1'
      : secureDefault;
    const domain = this.config.get<string>('ADMIN_COOKIE_DOMAIN') || undefined;
    const maxAgeRaw = this.config.get<string>('ADMIN_COOKIE_MAX_AGE_SECONDS');
    const maxAgeSeconds = maxAgeRaw && /^\d+$/.test(maxAgeRaw) ? Number(maxAgeRaw) : undefined;
    return { secure, domain, maxAgeSeconds };
  }

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
   * Admin login (PR-ADMIN-COOKIE-AUTH).
   *
   * Differs from `/auth/login` in three ways:
   *   1. Sets the session JWT as an HttpOnly cookie instead of
   *      returning it in the body. The admin SPA never sees the
   *      token — defends against the XSS-exfiltrates-token attack
   *      class that localStorage-based auth is exposed to.
   *   2. Asserts `user.isAdmin === true`. Non-admins get a 403 so
   *      the same login form on the admin surface fails loudly
   *      rather than silently dropping them into a useless session.
   *   3. Returns just `{ user }` (or the 2FA challenge envelope) —
   *      the response shape is the strict subset the SPA needs.
   *
   * 2FA flow: when 2FA is enabled the response is unchanged —
   * `{ needs2FA: true, challengeToken }`. The SPA then posts to
   * `/auth/admin/login/2fa` (NOT `/auth/login/2fa`) so the cookie
   * gets set + isAdmin gets re-checked after the second factor.
   * Throttle matches the user login.
   */
  @Throttle({ admin_login: { limit: 8, ttl: 60_000 } })
  @HttpCode(200)
  @Post('admin/login')
  async adminLogin(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
    @Headers(TRUSTED_DEVICE_HEADER) trustedDeviceToken?: string,
  ) {
    const result = await this.auth.login(dto, trustedDeviceToken ?? null);
    // 2FA challenge — pass through, no cookie yet (the challenge
    // token isn't a session).
    if ('needs2FA' in result && result.needs2FA) {
      return result;
    }
    const issued = result as { token: string; user: AuthedUser };
    if (!issued.user.isAdmin) {
      throw new ForbiddenException({ code: 'ADMIN_ACCESS_REQUIRED' });
    }
    res.setHeader(
      'Set-Cookie',
      serializeAdminCookie(issued.token, this.adminCookieOptions()),
    );
    return { user: issued.user };
  }

  /**
   * Admin login — 2FA completion. Mirrors `/auth/login/2fa` but
   * sets the cookie + asserts isAdmin.
   */
  @Throttle({ admin_login_2fa: { limit: 8, ttl: 60_000 } })
  @HttpCode(200)
  @Post('admin/login/2fa')
  async adminLoginTwoFactor(
    @Body() dto: Login2FADto,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') userAgent?: string,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    const result = await this.auth.completeLoginWith2FA({
      challengeToken: dto.challengeToken,
      code: dto.code,
      trustDevice: dto.trustDevice,
      userAgent: userAgent ?? null,
      acceptLanguage: acceptLanguage ?? null,
    });
    if (!result.user.isAdmin) {
      throw new ForbiddenException({ code: 'ADMIN_ACCESS_REQUIRED' });
    }
    res.setHeader(
      'Set-Cookie',
      serializeAdminCookie(result.token, this.adminCookieOptions()),
    );
    // Surface the trustedDevice cookie (if any) the same way as the
    // user-facing 2FA endpoint — the admin SPA's Next.js layer (if
    // it ever ships one) reads it the same way.
    const trustedDevice =
      'trustedDevice' in result ? result.trustedDevice : null;
    return { user: result.user, trustedDevice };
  }

  /**
   * Accept an inbound SSO bearer token and convert it to an admin
   * session cookie (PR-ADMIN-COOKIE-AUTH).
   *
   * Used when the user clicks `Open admin` from the Kalki hub app,
   * which hands us a Bearer token in the URL. The SPA POSTs here
   * with the same Bearer in the Authorization header, the
   * `JwtAuthGuard` validates it (via the existing JwtStrategy), we
   * assert isAdmin, mint a fresh full-length session token, set the
   * cookie, and return the user.
   *
   * Why we re-issue rather than reusing the bearer: the inbound
   * token might be a 60-second SSO handoff token (see
   * /auth/admin/sso-token) — too short for a real session. Issuing
   * a fresh 12h JWT means the cookie outlives the URL token cleanly.
   */
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('admin/sso-accept')
  async adminSsoAccept(
    @CurrentUser() user: AuthedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!user.isAdmin) {
      throw new ForbiddenException({ code: 'ADMIN_ACCESS_REQUIRED' });
    }
    // Re-issue a full-length session token (the inbound bearer
    // might be a 60s SSO handoff token, too short for a real
    // session). Default TTL is whatever's configured on the
    // JwtModule (currently 7d).
    const sessionToken = this.auth.reissueSessionToken(user);
    res.setHeader(
      'Set-Cookie',
      serializeAdminCookie(sessionToken, this.adminCookieOptions()),
    );
    return { user };
  }

  /**
   * Short-lived SSO handoff token (PR-ADMIN-COOKIE-AUTH).
   *
   * The admin SPA used to pass the long-lived session JWT to the
   * Bet exchange admin via `?token=…` in the URL. After moving to
   * httpOnly cookies the SPA can't read the JWT, so we mint a
   * tiny 60-second JWT here that:
   *
   *   - the admin SPA fetches via `credentials: 'include'`
   *     (proves possession of the cookie)
   *   - the SPA appends to the Bet URL
   *   - Bet validates against the same JWT_SECRET and mints its
   *     own session
   *
   * 60s is enough for the click-to-navigate window. The token has
   * the same `sub` + `email` as the cookie session, so Bet's SSO
   * route resolves the same admin identity.
   */
  @UseGuards(JwtAuthGuard)
  @Throttle({ admin_sso: { limit: 30, ttl: 60_000 } })
  @Post('admin/sso-token')
  adminSsoToken(@CurrentUser() user: AuthedUser): { token: string; expiresIn: number } {
    const token = this.auth.issueShortLivedSsoToken(user);
    return { token, expiresIn: 60 };
  }

  /**
   * Admin logout. Idempotent — even without an existing cookie this
   * just emits a `Max-Age=0` Set-Cookie which clears the cookie if
   * present and is a no-op otherwise.
   *
   * No JwtAuthGuard intentionally: an admin whose session JWT has
   * already expired (12h) still needs to be able to log out cleanly
   * without seeing a 401 first. The cookie clear is harmless when
   * there's no session.
   */
  @HttpCode(200)
  @Post('admin/logout')
  adminLogout(@Res({ passthrough: true }) res: Response): { ok: true } {
    res.setHeader('Set-Cookie', serializeAdminCookieClear(this.adminCookieOptions()));
    return { ok: true };
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
