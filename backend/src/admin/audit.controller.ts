import { Controller, Get, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { cursorPage } from '../common/pagination';
import { Perm } from './perms.guard';

/**
 * Read-only admin audit log API. Backs the `/admin/audit-log`
 * page in the admin SPA — every state-mutating admin action is
 * written to the `AdminAuditLog` table by the
 * `AuditLogService` (Foundation PR), and this endpoint surfaces
 * the rows for forensic review.
 *
 * Filtering (all optional, AND-ed):
 *   - actorId          ?actor=<userId>
 *   - actorEmail       ?actorEmail=<email>     (prefix match)
 *   - action           ?action=<exact>         (e.g. "auction.update")
 *   - targetType       ?targetType=<exact>
 *   - targetId         ?targetId=<exact>
 *   - correlationId    ?correlationId=<exact>
 *   - from / to        ?from=ISO&to=ISO
 *
 * Pagination: cursor-based on `id` (cuid is lexicographically
 * sortable + monotonic-ish across the same second). `?cursor=…`
 * + `?limit=N` (max 100).
 *
 * Endpoint is append-only — no PATCH / DELETE exposed. Retention
 * is managed by a separate background job (PR-AUDIT-RETENTION-1).
 *
 * Authorization: `audit.view` permission. Granted to ADMIN
 * (via the `'*'` wildcard), MODERATOR (so they can investigate
 * the trail behind a ban), and AUDITOR (their core surface).
 * Legacy `User.isAdmin = true` still passes via the PermsGuard
 * backstop until the backfill drops that column.
 */
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Perm('audit.view')
  @Get()
  async list(
    @Query('actor') actorId?: string,
    @Query('actorEmail') actorEmail?: string,
    @Query('action') action?: string,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('correlationId') correlationId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const limit = Math.max(1, Math.min(100, Number(limitRaw) || 50));

    const where: Prisma.AdminAuditLogWhereInput = {};
    if (actorId) where.actorId = actorId;
    if (actorEmail) where.actorEmail = { startsWith: actorEmail };
    if (action) where.action = action;
    if (targetType) where.targetType = targetType;
    if (targetId) where.targetId = targetId;
    if (correlationId) where.correlationId = correlationId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const rows = await this.prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        actorId: true,
        actorEmail: true,
        action: true,
        targetType: true,
        targetId: true,
        before: true,
        after: true,
        ipAddress: true,
        userAgent: true,
        correlationId: true,
        createdAt: true,
      },
    });

    const { page, nextCursor } = cursorPage(rows, limit);
    return {
      items: page.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor,
    };
  }

  /**
   * Distinct `action` values currently present in the log — drives
   * the action-filter dropdown in the admin UI so admins don't
   * have to remember the dotted-string slugs.
   */
  @Perm('audit.view')
  @Get('actions')
  async actions() {
    const rows = await this.prisma.adminAuditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
      take: 200,
    });
    return rows.map((r) => r.action);
  }

  /**
   * Distinct `targetType` values — same idea as `actions()` but
   * for the target-type filter.
   */
  @Perm('audit.view')
  @Get('target-types')
  async targetTypes() {
    const rows = await this.prisma.adminAuditLog.findMany({
      distinct: ['targetType'],
      select: { targetType: true },
      orderBy: { targetType: 'asc' },
      take: 50,
    });
    return rows.map((r) => r.targetType);
  }
}
