import { SetMetadata, applyDecorators, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from './roles.guard';

/**
 * RBAC decorator. Stacks JwtAuthGuard + RolesGuard + role metadata
 * in one shot — controllers just write:
 *
 *   @Roles(Role.ADMIN, Role.FINANCE)
 *   @Post('withdrawals/:id/approve')
 *   approve(...) { ... }
 *
 * Or for read-only access by AUDITOR or any operator role:
 *
 *   @Roles(Role.ADMIN, Role.MODERATOR, Role.FINANCE, Role.AUDITOR)
 *   @Get('audit-log')
 *   list(...) { ... }
 *
 * The RolesGuard loads the current user's active (non-revoked) roles
 * from `UserRole` joined on the JWT subject. On miss → 403.
 *
 * `User.isAdmin = true` still grants ADMIN via a backfill — see the
 * Foundation PR's bootstrap that writes `UserRole(ADMIN)` for every
 * existing `isAdmin: true` row.
 */
export const ROLES_METADATA_KEY = 'foundation:rbac:roles';

export function Roles(...roles: Role[]) {
  return applyDecorators(
    SetMetadata(ROLES_METADATA_KEY, roles),
    UseGuards(JwtAuthGuard, RolesGuard),
  );
}
