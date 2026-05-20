import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ROLES_METADATA_KEY } from './rbac.decorator';

/**
 * Verifies the JWT-resolved current user holds at least one of the
 * roles declared on the route. Loads roles from `UserRole` joined on
 * `User.id`, filtering out revoked grants.
 *
 * Falls back to `User.isAdmin` for ADMIN role — keeps legacy admin
 * accounts working until the Foundation PR's backfill migration adds
 * an explicit `UserRole(ADMIN)` row for every `isAdmin: true` user.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<Role[]>(
      ROLES_METADATA_KEY,
      ctx.getHandler(),
    );
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest();
    const user = req.user as { id: string; isAdmin?: boolean } | undefined;
    if (!user) throw new ForbiddenException('not authenticated');

    // Legacy ADMIN backstop — drop after the backfill is complete.
    if (user.isAdmin && required.includes(Role.ADMIN)) return true;

    const grants = await this.prisma.userRole.findMany({
      where: { userId: user.id, revokedAt: null },
      select: { role: true },
    });
    const have = new Set(grants.map((g) => g.role));
    const ok = required.some((r) => have.has(r));
    if (!ok) {
      throw new ForbiddenException(
        `missing role — requires one of [${required.join(', ')}]`,
      );
    }
    return true;
  }
}
