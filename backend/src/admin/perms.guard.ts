import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  Permission,
  permissionGranted,
  permissionsForRoles,
} from './permissions';

/**
 * Permission-level guard. Routes declare the slugs they need via
 * `@Perm('audit.view')`; this guard resolves the current user's
 * roles → permissions union → check.
 *
 * Multiple slugs on `@Perm(a, b)` are OR-ed: the user needs ANY
 * one of the listed permissions. Routes that genuinely require
 * compound auth should split into two route handlers, not list
 * them here — much easier to reason about at audit time.
 *
 * Backward compatibility:
 *
 *   - Legacy `User.isAdmin = true` grants every permission. This
 *     matches the existing `AdminGuard` contract so swapping a
 *     route from `@UseGuards(AdminGuard)` to `@Perm('...')` never
 *     breaks an existing admin account.
 *   - The backfill that copies `isAdmin: true` → `UserRole(ADMIN)`
 *     remains the path forward; once that's complete the
 *     `isAdmin` flag becomes a no-op.
 */
export const PERMS_METADATA_KEY = 'foundation:rbac:perms';

@Injectable()
export class PermsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<Permission[]>(
      PERMS_METADATA_KEY,
      ctx.getHandler(),
    );
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest();
    const user = req.user as { id: string; isAdmin?: boolean } | undefined;
    if (!user) throw new ForbiddenException('not authenticated');

    // Legacy ADMIN backstop — `isAdmin: true` ⇒ all permissions.
    if (user.isAdmin) return true;

    const grants = await this.prisma.userRole.findMany({
      where: { userId: user.id, revokedAt: null },
      select: { role: true },
    });
    const roles = grants.map((g) => g.role as Role);
    const held = permissionsForRoles(roles);
    const ok = required.some((r) => permissionGranted(held, r));
    if (!ok) {
      throw new ForbiddenException(
        `missing permission — requires one of [${required.join(', ')}]`,
      );
    }
    return true;
  }
}

/**
 * Route decorator. Stacks JwtAuthGuard + PermsGuard + permission
 * metadata in one shot:
 *
 *   @Perm('audit.view')
 *   @Get('audit')
 *   list(...) { ... }
 *
 * Multiple slugs are OR-ed:
 *
 *   @Perm('audit.view', 'reconciliation.view')
 *   @Get('forensic-overview')
 */
export function Perm(...perms: Permission[]) {
  return applyDecorators(
    SetMetadata(PERMS_METADATA_KEY, perms),
    UseGuards(JwtAuthGuard, PermsGuard),
  );
}
