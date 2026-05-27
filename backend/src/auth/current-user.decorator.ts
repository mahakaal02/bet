import { ExecutionContext, createParamDecorator } from '@nestjs/common';

export interface AuthedUser {
  id: string;
  email: string | null;
  username: string;
  emailVerified: boolean;
  coinBalance: number;
  isAdmin: boolean;
  /**
   * Present only when the JWT carried `purpose: 'impersonation'`.
   * `actorId` is the admin's real user id; `impersonationId` ties
   * the row in ImpersonationLog. Use ImpersonationScopeGuard +
   * @DenyImpersonated to block sensitive flows when this is set.
   *
   * Controllers should NOT serialize this field outward.
   */
  _impersonation?: {
    actorId: string;
    impersonationId: string | null;
  };
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthedUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as AuthedUser;
  },
);
