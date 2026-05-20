import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { IsEnum } from 'class-validator';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../foundation/audit-log.service';

/**
 * RBAC admin API. Drives the `/roles` admin SPA page where an
 * admin grants / revokes operator roles on user accounts.
 *
 *   GET  /admin/roles/users?q=…       — search users (email,
 *                                       username, displayName)
 *   GET  /admin/roles/users/:id        — full user + role grants
 *   POST /admin/roles/users/:id/grant  — { role } — grant a role
 *   POST /admin/roles/users/:id/revoke — { role } — soft-revoke
 *
 * Every grant + revoke writes an `AdminAuditLog` entry with the
 * before/after role set. The audit log + this controller together
 * give a complete forensic trail of operator-permission changes.
 *
 * Authorization: admin-only via the existing `AdminGuard`. The
 * Foundation PR's `User.isAdmin` flag is still the legacy gate;
 * once new ADMIN grants land here as `UserRole(ADMIN)` rows the
 * legacy flag becomes a no-op (kept for backward compat).
 */
class GrantRevokeDto {
  @IsEnum(Role)
  role!: Role;
}

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/roles')
export class AdminRolesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Lightweight user search backing the admin UI's autocomplete.
   * Postgres trigram is overkill for our current row count — a
   * plain ILIKE prefix match against email + username + display
   * name is fast enough, max 20 results.
   */
  @Get('users')
  async searchUsers(@Query('q') q: string) {
    const query = (q ?? '').trim();
    if (!query) return { items: [] };
    if (query.length < 2) {
      throw new BadRequestException('search query must be at least 2 chars');
    }

    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { email: { contains: query, mode: 'insensitive' } },
          { username: { contains: query, mode: 'insensitive' } },
          { displayName: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ username: 'asc' }],
      take: 20,
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        isAdmin: true,
        bannedAt: true,
        createdAt: true,
      },
    });
    return {
      items: users.map((u) => ({
        ...u,
        createdAt: u.createdAt.toISOString(),
        bannedAt: u.bannedAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * Single-user view — the row plus all active and revoked role
   * grants. Revoked grants are kept (soft delete) so the audit
   * trail shows when each role was held.
   */
  @Get('users/:id')
  async getUser(@Param('id') id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        isAdmin: true,
        bannedAt: true,
        bannedReason: true,
        bannedBy: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('user not found');

    const grants = await this.prisma.userRole.findMany({
      where: { userId: id },
      orderBy: { grantedAt: 'desc' },
    });

    return {
      ...user,
      createdAt: user.createdAt.toISOString(),
      bannedAt: user.bannedAt?.toISOString() ?? null,
      grants: grants.map((g) => ({
        role: g.role,
        grantedBy: g.grantedBy,
        grantedAt: g.grantedAt.toISOString(),
        revokedAt: g.revokedAt?.toISOString() ?? null,
        active: g.revokedAt == null,
      })),
    };
  }

  @Post('users/:id/grant')
  async grant(
    @Param('id') userId: string,
    @Body() dto: GrantRevokeDto,
    @CurrentUser() actor: AuthedUser,
    @Req() req: { headers: Record<string, string | string[] | undefined>; ip?: string },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, username: true },
    });
    if (!user) throw new NotFoundException('user not found');

    // Capture the before-state for the audit entry. We include
    // ALL active grants (not just the one being modified) so the
    // diff is self-contained.
    const before = await this.prisma.userRole.findMany({
      where: { userId, revokedAt: null },
      select: { role: true },
    });

    // Re-grant: if a revoked grant for this role exists, clear
    // `revokedAt` so we keep the original grantedAt for audit
    // continuity rather than thrashing rows.
    await this.prisma.userRole.upsert({
      where: { userId_role: { userId, role: dto.role } },
      update: {
        revokedAt: null,
        grantedBy: actor.id,
        grantedAt: new Date(),
      },
      create: {
        userId,
        role: dto.role,
        grantedBy: actor.id,
      },
    });

    const after = await this.prisma.userRole.findMany({
      where: { userId, revokedAt: null },
      select: { role: true },
    });

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email ?? actor.username,
      action: 'roles.grant',
      targetType: 'User',
      targetId: userId,
      before: { activeRoles: before.map((g) => g.role) },
      after: { activeRoles: after.map((g) => g.role), grantedRole: dto.role },
      ipAddress: extractIp(req),
      userAgent: pickHeader(req, 'user-agent') ?? undefined,
    });

    return { ok: true, role: dto.role, activeRoles: after.map((g) => g.role) };
  }

  @Post('users/:id/revoke')
  async revoke(
    @Param('id') userId: string,
    @Body() dto: GrantRevokeDto,
    @CurrentUser() actor: AuthedUser,
    @Req() req: { headers: Record<string, string | string[] | undefined>; ip?: string },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, username: true },
    });
    if (!user) throw new NotFoundException('user not found');

    // Don't allow an admin to revoke their own ADMIN role — that's
    // a self-lockout footgun. Any other admin can revoke them.
    if (actor.id === userId && dto.role === Role.ADMIN) {
      throw new BadRequestException(
        'cannot revoke your own ADMIN role — ask another admin to do it',
      );
    }

    const before = await this.prisma.userRole.findMany({
      where: { userId, revokedAt: null },
      select: { role: true },
    });

    // Soft revoke — keep the row for audit, set revokedAt.
    const updated = await this.prisma.userRole.updateMany({
      where: { userId, role: dto.role, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new BadRequestException('user does not hold that role');
    }

    const after = await this.prisma.userRole.findMany({
      where: { userId, revokedAt: null },
      select: { role: true },
    });

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email ?? actor.username,
      action: 'roles.revoke',
      targetType: 'User',
      targetId: userId,
      before: { activeRoles: before.map((g) => g.role) },
      after: { activeRoles: after.map((g) => g.role), revokedRole: dto.role },
      ipAddress: extractIp(req),
      userAgent: pickHeader(req, 'user-agent') ?? undefined,
    });

    return { ok: true, role: dto.role, activeRoles: after.map((g) => g.role) };
  }

  /** All known roles — drives the role-picker dropdown in the UI. */
  @Get()
  listRoles() {
    return { roles: Object.values(Role) };
  }
}

function extractIp(req: {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}): string | undefined {
  const xff = req.headers['x-forwarded-for'];
  if (Array.isArray(xff)) return xff[0]?.split(',')[0]?.trim();
  if (typeof xff === 'string') return xff.split(',')[0]?.trim();
  return req.ip;
}

function pickHeader(
  req: { headers: Record<string, string | string[] | undefined> },
  name: string,
): string | null {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}
