import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { AuthService, JwtPayload } from './auth.service';
import { ADMIN_COOKIE_NAME, parseCookieHeader } from './cookie';

/**
 * Custom extractor: pull the JWT from the `kalki_admin_session`
 * cookie (PR-ADMIN-COOKIE-AUTH). The cookie path is the second
 * choice; Authorization: Bearer wins when both are present so a
 * misconfigured admin browser that ALSO sends Bearer (e.g. via
 * DevTools) doesn't accidentally authenticate as the cookie's
 * principal — the explicit Bearer beats the ambient cookie.
 */
function extractFromAdminCookie(req: Request | undefined): string | null {
  const raw = req?.headers?.cookie;
  if (!raw) return null;
  const cookies = parseCookieHeader(raw);
  return cookies[ADMIN_COOKIE_NAME] ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private readonly auth: AuthService) {
    super({
      // Mobile / API clients keep using Authorization: Bearer
      // (PR-ADMIN-COOKIE-AUTH is opt-in via the new /auth/admin
      // endpoints). The cookie extractor is the new admin path.
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        extractFromAdminCookie,
      ]),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') ?? 'dev-secret',
    });
  }

  async validate(payload: JwtPayload) {
    return this.auth.validateJwt(payload);
  }
}
