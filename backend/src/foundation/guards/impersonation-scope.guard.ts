import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthedUser } from '../../auth/current-user.decorator';
import { DENY_IMPERSONATED_KEY } from '../decorators/deny-impersonated.decorator';

/**
 * Blocks impersonation-purpose JWTs from reaching @DenyImpersonated
 * routes (PR-ARCH-AUDIT, Stage A).
 *
 * Registered globally in main.ts so that any controller method (or
 * controller class) tagged with @DenyImpersonated() is enforced
 * without needing per-route @UseGuards. Routes that are NOT tagged
 * proceed unchanged — this guard is opt-IN by decorator.
 *
 * Order matters: JwtAuthGuard must run BEFORE this guard so that
 * req.user is populated. Since JwtAuthGuard is applied at the
 * controller/method level via @UseGuards and this guard is global,
 * Nest's guard-order rule (global → controller → method, all run)
 * ensures the right sequencing — but ALL guards must return true.
 *
 * We tolerate `req.user` being absent (unauthed route) by letting
 * the request through — JwtAuthGuard, if applied, will already have
 * 401'd. If JwtAuthGuard wasn't applied at all, the route is public
 * and impersonation has no meaning there.
 */
@Injectable()
export class ImpersonationScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const deny = this.reflector.getAllAndOverride<boolean>(DENY_IMPERSONATED_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!deny) return true;

    const req = ctx.switchToHttp().getRequest();
    const user = req.user as AuthedUser | undefined;
    if (!user) return true;
    if (user._impersonation) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message:
          'this action is not allowed while impersonating a user — end the impersonation session first',
      });
    }
    return true;
  }
}
