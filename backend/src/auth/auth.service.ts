import {
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
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly rg: ResponsibleGamblingService,
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

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (!user) throw new UnauthorizedException('invalid credentials');

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('invalid credentials');

    // Responsible-gambling gate. Blocks sign-in when the account is
    // in a cooldown or self-exclusion period. Throws Forbidden.
    await this.rg.assertCanLogin(user.id);

    return this.issue(user, this.sanitize(user));
  }

  async validateJwt(payload: JwtPayload) {
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
