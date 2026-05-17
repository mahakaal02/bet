import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthedUser } from '../auth/current-user.decorator';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user as AuthedUser | undefined;
    if (!user?.isAdmin) throw new ForbiddenException('admin only');
    return true;
  }
}
