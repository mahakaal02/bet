import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { ResponsibleGamblingService } from '../responsible-gambling/responsible-gambling.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { TwoFactorService } from './two-factor.service';
import { TrustedDeviceService } from './trusted-device.service';

export interface JwtPayload {
  sub: string;
  username: string;
  /**
   * Email + phone are embedded so other services (Bet / Kalki Exchange) can
   * identify the user from the JWT alone, without an extra round-trip back
   * to this backend. Either may be undefined depending on the signup path:
   * email-first signup omits `phone`, WhatsApp signup omits `email`.
   */
  email?: string | null;
  phone?: string | null;
  /**
   * Issued-at timestamp (seconds since epoch). Set automatically by
   * `@nestjs/jwt`. Used by `validateJwt()` together with
   * `User.passwordChangedAt` to invalidate every existing token after
   * a password reset — see `password-reset.service.ts`.
   */
  iat?: number;
  /**
   * Tokens with a `purpose` tag are scoped to a specific flow:
   *
   *   - `'2fa_challenge'` — intermediate 2FA login token. Only the
   *     `/auth/login/2fa` route accepts it; `validateJwt()` rejects
   *     it for any other route.
   *   - `'impersonation'` — admin-issued "act as" token. Routes
   *     accept it as a normal session for the impersonated user
   *     (so downstream code Just Works), but the `actorId` /
   *     `impersonationId` fields on the payload tell audit
   *     writers who's actually behind the wheel.
   */
  purpose?: '2fa_challenge' | 'impersonation';
  /** Set on impersonation tokens — the admin's user id. */
  actorId?: string;
  /** Set on impersonation tokens — the ImpersonationLog row id. */
  impersonationId?: string;
}

const TFA_CHALLENGE_TTL = '5m';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly rg: ResponsibleGamblingService,
    private readonly twoFactor: TwoFactorService,
    private readonly trustedDevice: TrustedDeviceService,
  ) {}

  async register(dto: RegisterDto) {
    const rounds = Number(this.config.get('BCRYPT_ROUNDS') ?? 10);
    const passwordHash = await bcrypt.hash(dto.password, rounds);

    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email.toLowerCase(),
          username: dto.username,
          passwordHash,
        },
      });
      return this.issue(user, this.sanitize(user));
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException('email or username already in use');
      }
      throw e;
    }
  }

  async login(dto: LoginDto, trustedDeviceToken?: string | null) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (!user) throw new UnauthorizedException('invalid credentials');

    // OAuth-only accounts (e.g. Telegram sign-up) have `passwordHash = null`
    // — they CANNOT log in via email+password. Reject with the same generic
    // message so the response is indistinguishable from "wrong password" /
    // "no such email" (don't leak account-existence or auth-method).
    if (!user.passwordHash) {
      throw new UnauthorizedException('invalid credentials');
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('invalid credentials');

    // Responsible-gambling gate runs FIRST. Blocks sign-in when the
    // account is in a cooldown or self-exclusion period — short-
    // circuits before the 2FA challenge so a self-excluded user
    // doesn't get a "scan your code" prompt for an account they
    // already chose to lock down.
    await this.rg.assertCanLogin(user.id);

    // Step-up: if 2FA is enabled, don't issue a normal session yet —
    // hand the client a short-lived "challenge" token that only the
    // /auth/login/2fa endpoint accepts.
    const twoFactor = await this.prisma.twoFactorAuth.findUnique({
      where: { userId: user.id },
      select: { verified: true, disabledAt: true },
    });
    if (twoFactor?.verified && !twoFactor.disabledAt) {
      // Trusted-device bypass: if the browser carries an opaque
      // trusted-device cookie that matches an active row for this
      // user, skip the 2FA prompt entirely. The cookie is bound to
      // the user via the `(userId, deviceHash)` unique constraint,
      // so it can't be reused across accounts.
      if (trustedDeviceToken) {
        const trusted = await this.trustedDevice.verify(
          user.id,
          trustedDeviceToken,
        );
        if (trusted) {
          return this.issue(user, this.sanitize(user));
        }
      }
      const challengeToken = this.jwt.sign(
        {
          sub: user.id,
          username: user.username,
          purpose: '2fa_challenge',
        } satisfies JwtPayload,
        { expiresIn: TFA_CHALLENGE_TTL },
      );
      return { needs2FA: true as const, challengeToken };
    }

    return this.issue(user, this.sanitize(user));
  }

  /**
   * Complete a login that was challenged by 2FA. The challenge token
   * is a short-lived JWT carrying `purpose: '2fa_challenge'`; we
   * verify it, then route the code through `TwoFactorService.verifyLogin`
   * (TOTP or backup code), then issue the real session.
   *
   * When the client passes `trustDevice: true`, we ALSO mint a
   * TrustedDevice row + return its opaque cookie value so the
   * proxy can set the long-lived "skip-2FA-on-this-browser" cookie.
   */
  async completeLoginWith2FA(input: {
    challengeToken: string;
    code: string;
    trustDevice?: boolean;
    userAgent?: string | null;
    acceptLanguage?: string | null;
  }) {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(input.challengeToken);
    } catch {
      throw new UnauthorizedException('challenge token is invalid or expired');
    }
    if (payload.purpose !== '2fa_challenge' || !payload.sub) {
      throw new BadRequestException('challenge token is not a 2FA challenge');
    }

    await this.twoFactor.verifyLogin(payload.sub, input.code);

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) throw new UnauthorizedException();
    // RG check again on the 2FA-completion path — covers the edge
    // case where the user starts self-exclusion between password
    // step and 2FA step (e.g. opens RG page in another tab).
    await this.rg.assertCanLogin(user.id);

    const session = this.issue(user, this.sanitize(user));

    if (input.trustDevice) {
      const minted = await this.trustedDevice.mint({
        userId: user.id,
        userAgent: input.userAgent ?? null,
        acceptLanguage: input.acceptLanguage ?? null,
      });
      return {
        ...session,
        trustedDevice: {
          cookieValue: minted.cookieValue,
          expiresAt: minted.expiresAt.toISOString(),
        },
      };
    }

    return session;
  }

  async validateJwt(payload: JwtPayload) {
    // 2FA-challenge tokens MAY NOT be used for general auth — they
    // authenticate only the `/auth/login/2fa` endpoint, and that path
    // verifies + consumes them inside `completeLoginWith2FA()`.
    // Refusing them here closes the obvious side-channel where an
    // attacker who intercepts a challenge token could otherwise treat
    // it as a session.
    if (payload.purpose === '2fa_challenge') {
      throw new UnauthorizedException(
        'this token is for completing 2FA only — full login required',
      );
    }
    // Impersonation tokens DO authenticate normal routes — by design,
    // they let the admin exercise the user's surface as the user.
    // The `actorId` / `impersonationId` fields propagate via the
    // request user shape so audit writers can attribute correctly.
    // No special branch here; let the rest of validateJwt run.

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException();
    // Session-invalidation anchor: if the user has rotated their
    // password (via password-reset) since this token was issued, the
    // JWT is stale and must be rejected. `iat` is seconds; the column
    // is milliseconds — compare in seconds for parity.
    if (user.passwordChangedAt && typeof payload.iat === 'number') {
      const changedAtSec = Math.floor(user.passwordChangedAt.getTime() / 1000);
      if (payload.iat < changedAtSec) {
        throw new UnauthorizedException('session invalidated — please sign in again');
      }
    }
    // RG also runs on every authed request — a freshly self-excluded
    // user shouldn't be able to ride out the day on a still-valid JWT.
    await this.rg.assertCanLogin(user.id);
    return this.sanitize(user);
  }

  private issue(
    u: { id: string; username: string; email: string | null; whatsappPhone?: string | null },
    user: ReturnType<AuthService['sanitize']>,
  ) {
    const token = this.jwt.sign({
      sub: u.id,
      username: u.username,
      email: u.email ?? undefined,
      phone: u.whatsappPhone ?? undefined,
    } satisfies JwtPayload);
    return { token, user };
  }

  /**
   * Mint a 60-second JWT for cross-app SSO handoff
   * (PR-ADMIN-COOKIE-AUTH). The admin SPA, which holds the session
   * only as an httpOnly cookie, can't pass its long-lived JWT to
   * Bet's `?token=` URL handoff anymore — so it fetches this short
   * token via `credentials: 'include'` (proving cookie possession)
   * and tucks it into the URL.
   *
   * The downstream app validates the token against the shared
   * `JWT_SECRET`. 60s is enough for the click-to-navigate window;
   * a shorter TTL hardens against URL leaking via browser history /
   * referrer headers / server access logs.
   */
  issueShortLivedSsoToken(user: {
    id: string;
    username: string;
    email: string | null;
  }): string {
    return this.jwt.sign(
      {
        sub: user.id,
        username: user.username,
        email: user.email ?? undefined,
      } satisfies JwtPayload,
      { expiresIn: '60s' },
    );
  }

  /**
   * Mint a fresh full-length session JWT for an already-validated
   * user. Used by `/auth/admin/sso-accept` to upgrade a 60s SSO
   * handoff token into a proper 7-day admin session cookie.
   *
   * Mirrors `issue()` but takes the sanitized AuthedUser shape that
   * the controller already has from `@CurrentUser()`.
   */
  reissueSessionToken(user: {
    id: string;
    username: string;
    email: string | null;
  }): string {
    return this.jwt.sign({
      sub: user.id,
      username: user.username,
      email: user.email ?? undefined,
    } satisfies JwtPayload);
  }

  private sanitize(u: { id: string; email: string | null; username: string; emailVerified: boolean; isAdmin: boolean }) {
    // `coinBalance` returned as 0 here is a placeholder for the API
    // contract — the actual balance comes from Bet (the unified wallet)
    // and is overlaid in `auth.controller.ts::me`. Login + register
    // responses use 0; clients refresh via /auth/me on next tick.
    return {
      id: u.id,
      email: u.email,
      username: u.username,
      emailVerified: u.emailVerified,
      coinBalance: 0,
      isAdmin: u.isAdmin,
    };
  }
}
