import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../foundation/audit-log.service';
import { JwtPayload } from '../auth/auth.service';
import { cursorPage } from '../common/pagination';

/**
 * Admin impersonation (Roadmap §F-ADMIN-2 / Q2 follow-up).
 *
 * Lets an admin "act as" another user for support investigation — see
 * the user's screen the way they see it, exercise the same routes,
 * surface bugs that only show up in a real account. Every action
 * taken under impersonation is attributable back to the original
 * admin via the `ImpersonationLog` row (linked by id), and the JWT
 * carries the admin's `actorId` plus a `purpose: 'impersonation'`
 * tag so downstream audit-log writers can capture the dual-identity.
 *
 * Security model
 *
 *   - **Reason required**: 10+ chars of free-text. Forces deliberate
 *     declaration before the row is written.
 *   - **Short TTL**: 1 hour. Impersonation should be an investigation
 *     tool, not a parallel session that lingers.
 *   - **Cannot impersonate another admin**. The target must have a
 *     plain `isAdmin: false` row. This stops privilege escalation
 *     within the admin tier.
 *   - **Cannot self-impersonate** (no actual security risk, just
 *     a guard against weird audit-trail data).
 *   - **End-flow**: explicit `end()` writes `endedAt` on the
 *     ImpersonationLog row. The JWT itself isn't revocable on
 *     demand (no JWT revocation list at this layer), but the
 *     1-hour TTL bounds the worst case, and the row is the
 *     canonical "did this happen" record.
 *
 * The impersonation JWT is a `purpose: 'impersonation'` payload
 * marker — `validateJwt` accepts it as a regular session for the
 * impersonated user (so all downstream endpoints behave naturally)
 * but the request user shape carries an `actingAs.adminId` field
 * that audit-log writers can attribute to. That cross-cutting
 * enrichment lands in PR-IMPERSONATE-2 — for this PR, the
 * ImpersonationLog row alone is the audit trail (correlate by
 * timestamp + adminId).
 */
@Injectable()
export class ImpersonationService {
  private readonly logger = new Logger(ImpersonationService.name);
  private static readonly TTL = '1h';
  private static readonly MIN_REASON_LEN = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Start an impersonation session. Returns the JWT the admin's
   * client will use to act as the user (in place of their own
   * admin token). The admin's original token isn't touched —
   * they can keep it cached and re-use it once `end()` runs.
   */
  async start(input: {
    admin: { id: string; email: string | null; username: string };
    targetUserId: string;
    reason: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<{
    token: string;
    expiresIn: string;
    impersonationId: string;
    user: {
      id: string;
      email: string | null;
      username: string;
      displayName: string | null;
    };
  }> {
    const reason = (input.reason ?? '').trim();
    if (reason.length < ImpersonationService.MIN_REASON_LEN) {
      throw new BadRequestException(
        `reason must be at least ${ImpersonationService.MIN_REASON_LEN} characters — be specific (e.g. "ticket #1234, user reports stuck withdrawal")`,
      );
    }

    if (input.admin.id === input.targetUserId) {
      throw new BadRequestException('cannot impersonate yourself');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: input.targetUserId },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        isAdmin: true,
      },
    });
    if (!target) throw new NotFoundException('target user not found');
    if (target.isAdmin) {
      // Stops admin-on-admin impersonation as a privilege-escalation
      // path. If a real ops case ever needs it, that's a separate,
      // explicit endpoint with stricter audit + dual-control.
      throw new ForbiddenException(
        'cannot impersonate another admin account',
      );
    }

    const row = await this.prisma.impersonationLog.create({
      data: {
        adminId: input.admin.id,
        userId: target.id,
        reason,
        actions: [] as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    // Mirror to the AdminAuditLog — gives the audit UI a row that
    // shows up under the actor's normal action history. The
    // ImpersonationLog row is the canonical store; this is the
    // grep-friendly index.
    await this.audit.record({
      actorId: input.admin.id,
      actorEmail: input.admin.email ?? input.admin.username,
      action: 'impersonation.start',
      targetType: 'User',
      targetId: target.id,
      before: null,
      after: {
        impersonationId: row.id,
        reason,
        targetUsername: target.username,
      },
      ipAddress: input.ipAddress ?? undefined,
      userAgent: input.userAgent ?? undefined,
    });

    const token = this.jwt.sign(
      {
        sub: target.id,
        username: target.username,
        email: target.email ?? undefined,
        purpose: 'impersonation',
        actorId: input.admin.id,
        impersonationId: row.id,
      } satisfies ImpersonationPayload,
      { expiresIn: ImpersonationService.TTL },
    );

    return {
      token,
      expiresIn: ImpersonationService.TTL,
      impersonationId: row.id,
      user: {
        id: target.id,
        email: target.email,
        username: target.username,
        displayName: target.displayName,
      },
    };
  }

  /**
   * Close an impersonation session. Doesn't invalidate the issued
   * JWT (no revocation list), but the closure stamps `endedAt` on
   * the audit row so the timeline is well-defined. The 1-hour
   * TTL bounds residual reachability.
   */
  async end(adminId: string, impersonationId: string) {
    const row = await this.prisma.impersonationLog.findUnique({
      where: { id: impersonationId },
      select: { id: true, adminId: true, userId: true, endedAt: true },
    });
    if (!row) throw new NotFoundException('impersonation not found');
    if (row.adminId !== adminId) {
      throw new ForbiddenException('not your impersonation session');
    }
    if (row.endedAt) {
      return { endedAt: row.endedAt.toISOString() };       // idempotent
    }
    const updated = await this.prisma.impersonationLog.update({
      where: { id: impersonationId },
      data: { endedAt: new Date() },
      select: { endedAt: true, userId: true },
    });

    await this.audit.record({
      actorId: adminId,
      actorEmail: '',                                       // filled by caller via interceptor
      action: 'impersonation.end',
      targetType: 'User',
      targetId: row.userId,
      before: null,
      after: { impersonationId },
    });

    return { endedAt: updated.endedAt!.toISOString() };
  }

  /**
   * Paginated history for the admin audit page. Filterable by either
   * the impersonating admin OR the target user — admins use the
   * first, users browsing their own "who acted as me" view use the
   * second.
   */
  async list(filter: { adminId?: string; userId?: string; limit?: number; cursor?: string }) {
    const limit = Math.max(1, Math.min(100, filter.limit ?? 50));
    const where: Prisma.ImpersonationLogWhereInput = {};
    if (filter.adminId) where.adminId = filter.adminId;
    if (filter.userId) where.userId = filter.userId;

    const rows = await this.prisma.impersonationLog.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        adminId: true,
        userId: true,
        startedAt: true,
        endedAt: true,
        reason: true,
        admin: { select: { username: true, email: true } },
        user: { select: { username: true } },
      },
    });
    const { page, nextCursor } = cursorPage(rows, limit);
    const items = page.map((r) => ({
      id: r.id,
      adminId: r.adminId,
      adminUsername: r.admin.username,
      adminEmail: r.admin.email,
      userId: r.userId,
      userUsername: r.user.username,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt?.toISOString() ?? null,
      reason: r.reason,
      durationMs:
        (r.endedAt?.getTime() ?? Date.now()) - r.startedAt.getTime(),
    }));
    return { items, nextCursor };
  }
}

/**
 * JWT shape for an impersonation token. The base `JwtPayload`'s
 * `purpose` field already has `'2fa_challenge'`; this PR extends
 * it via the union below.
 */
export interface ImpersonationPayload extends JwtPayload {
  purpose: 'impersonation';
  actorId: string;
  impersonationId: string;
}
