import { Injectable } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

/**
 * Append-only admin audit log writer. Every state-mutating admin
 * action goes through here. The interceptor in
 * `audit-log.interceptor.ts` handles the common case (it diffs the
 * before/after of route-level Prisma writes); this service is the
 * direct call path for cases where the interceptor can't introspect
 * the write (e.g. a multi-table transaction).
 *
 * Design invariants:
 *
 *   1. No UPDATE/DELETE API exposed — pure append-only. Database
 *      writes are restricted to INSERT via row-level security in
 *      a follow-up hardening PR.
 *   2. Correlation IDs flow from a request-scoped middleware so
 *      multi-row audit entries from the same admin click are easy
 *      to link in the search UI.
 *   3. Before/after diffs are SPARSE — only the changed columns,
 *      not the whole row — to keep payload sizes bounded.
 *   4. Sensitive columns (passwordHash, encryptedSecret) are masked
 *      to `"<redacted>"` before diffing.
 *
 * Retention: 7 years (financial compliance). Archive job in
 * PR-AUDIT-1 moves rows > 2y to S3 cold storage.
 */
@Injectable()
export class AuditLogService {
  private static readonly REDACTED_COLUMNS = new Set([
    'passwordHash',
    'encryptedSecret',
    'tokenHash',
    'oldTokenHash',
    'newTokenHash',
    'codeHash',
  ]);

  constructor(private readonly prisma: PrismaClient) {}

  async record(entry: {
    actorId: string;
    actorEmail: string;
    action: string;                              // e.g. "auction.update"
    targetType: string;                          // e.g. "Auction"
    targetId: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    ipAddress?: string;
    userAgent?: string;
    correlationId?: string;
  }) {
    return this.prisma.adminAuditLog.create({
      data: {
        actorId: entry.actorId,
        actorEmail: entry.actorEmail,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        before: AuditLogService.redact(entry.before) as Prisma.InputJsonValue,
        after: AuditLogService.redact(entry.after) as Prisma.InputJsonValue,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        correlationId: entry.correlationId,
      },
    });
  }

  /**
   * Strip sensitive fields before persisting. Mutates a copy, not the
   * original — important so the controller can still read the real
   * row state for its own response shaping.
   */
  private static redact(
    row: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> | undefined {
    if (!row) return undefined;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(row)) {
      out[k] = AuditLogService.REDACTED_COLUMNS.has(k) ? '<redacted>' : row[k];
    }
    return out;
  }
}
