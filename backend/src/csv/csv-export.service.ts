import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../foundation/audit-log.service';

/**
 * CSV export (Roadmap §F-ADMIN-9).
 *
 * Streams rows from the DB → CSV → HTTP response without buffering
 * the whole dataset in memory. 100k+ row dumps are routine for the
 * audit log + ledger tables, so streaming matters: at ~120 bytes/row
 * a 100k-row buffer would consume ~12 MB of heap per concurrent
 * export, and Node's GC pauses get nasty under that pressure.
 *
 * Strategy:
 *
 *   1. The controller opens a writable response with Content-Type
 *      `text/csv` + a Content-Disposition filename.
 *   2. This service emits the header row + iterates a cursor-paged
 *      Prisma query, writing CSV lines as it goes.
 *   3. Each batch is flushed before reading the next.
 *
 * CSV correctness: every field is wrapped in `csvEscape()` which
 * doubles inner quotes and quotes any value containing `,` / `"` /
 * `\n`. Locale-sensitive numbers (currency) get pre-formatted as
 * plain integer strings so Excel doesn't add thousands separators.
 *
 * Auditing: every export call writes an AdminAuditLog row with the
 * actor, resource, and row count. PII-containing exports
 * (CoinTransaction has userId, etc.) are admin-only via the
 * permission slug `ledger.export` / `audit.view`.
 */
@Injectable()
export class CsvExportService {
  private readonly logger = new Logger(CsvExportService.name);

  // Page size — small enough to keep heap bounded, big enough that
  // we're not doing 1000s of round-trips for a 100k export.
  static readonly BATCH = 500;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Audit log export. Cursor-paged on `id` for deterministic order.
   * `from` / `to` filter on `createdAt`. Returns an async iterable
   * of CSV-encoded rows including the header.
   */
  async *exportAuditLog(input: { from?: Date; to?: Date }): AsyncGenerator<string> {
    yield csvRow([
      'id', 'createdAt', 'actorId', 'actorEmail', 'action',
      'targetType', 'targetId', 'ipAddress', 'userAgent', 'correlationId',
    ]);
    let cursor: string | undefined;
    let pageCount = 0;
    while (true) {
      const rows = await this.prisma.adminAuditLog.findMany({
        where: this.dateRange(input.from, input.to),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: CsvExportService.BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (rows.length === 0) break;
      for (const r of rows) {
        yield csvRow([
          r.id, r.createdAt.toISOString(), r.actorId, r.actorEmail, r.action,
          r.targetType, r.targetId,
          r.ipAddress ?? '', r.userAgent ?? '', r.correlationId ?? '',
        ]);
      }
      cursor = rows[rows.length - 1].id;
      pageCount += 1;
      if (rows.length < CsvExportService.BATCH) break;
      // Safety belt: 1M rows max per export. Force the caller to
      // narrow the date range above that.
      if (pageCount * CsvExportService.BATCH >= 1_000_000) {
        throw new BadRequestException({
          code: 'EXPORT_TOO_LARGE',
          message: 'Narrow the date range — exports are capped at 1M rows.',
        });
      }
    }
  }

  /**
   * Coin-transaction ledger export. Includes reference column so
   * finance can join back to payment ids etc.
   */
  async *exportCoinTransactions(input: { from?: Date; to?: Date }): AsyncGenerator<string> {
    yield csvRow(['id', 'createdAt', 'userId', 'delta', 'reason', 'reference']);
    let cursor: string | undefined;
    let pageCount = 0;
    while (true) {
      const rows = await this.prisma.coinTransaction.findMany({
        where: this.dateRange(input.from, input.to),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: CsvExportService.BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (rows.length === 0) break;
      for (const r of rows) {
        yield csvRow([
          r.id, r.createdAt.toISOString(), r.userId,
          String(r.delta), r.reason, r.reference ?? '',
        ]);
      }
      cursor = rows[rows.length - 1].id;
      pageCount += 1;
      if (rows.length < CsvExportService.BATCH) break;
      if (pageCount * CsvExportService.BATCH >= 1_000_000) {
        throw new BadRequestException({ code: 'EXPORT_TOO_LARGE' });
      }
    }
  }

  /** Order lifecycle export — ops-side dashboard. */
  async *exportOrders(input: { from?: Date; to?: Date }): AsyncGenerator<string> {
    yield csvRow([
      'id', 'createdAt', 'updatedAt', 'auctionId', 'winnerId', 'status',
      'carrierName', 'trackingNumber', 'shippedAt', 'deliveredAt', 'disputedAt',
    ]);
    let cursor: string | undefined;
    let pageCount = 0;
    while (true) {
      const rows = await this.prisma.order.findMany({
        where: this.dateRange(input.from, input.to),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: CsvExportService.BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (rows.length === 0) break;
      for (const r of rows) {
        yield csvRow([
          r.id, r.createdAt.toISOString(), r.updatedAt.toISOString(),
          r.auctionId, r.winnerId, r.status,
          r.carrierName ?? '', r.trackingNumber ?? '',
          r.shippedAt?.toISOString() ?? '',
          r.deliveredAt?.toISOString() ?? '',
          r.disputedAt?.toISOString() ?? '',
        ]);
      }
      cursor = rows[rows.length - 1].id;
      pageCount += 1;
      if (rows.length < CsvExportService.BATCH) break;
      if (pageCount * CsvExportService.BATCH >= 1_000_000) {
        throw new BadRequestException({ code: 'EXPORT_TOO_LARGE' });
      }
    }
  }

  async recordExport(input: {
    adminId: string;
    adminEmail: string;
    resource: string;
    rowCount: number;
    from?: Date;
    to?: Date;
  }) {
    await this.audit.record({
      actorId: input.adminId,
      actorEmail: input.adminEmail,
      action: 'csv.export',
      targetType: 'CsvExport',
      targetId: input.resource,
      after: {
        rowCount: input.rowCount,
        from: input.from?.toISOString() ?? null,
        to: input.to?.toISOString() ?? null,
      },
    });
  }

  private dateRange(from?: Date, to?: Date) {
    if (!from && !to) return {};
    return {
      createdAt: {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      },
    };
  }
}

// ─── CSV helpers ─────────────────────────────────────────────────

/**
 * Escape a single CSV field. Quote-wrap if the value contains any
 * of `,` / `"` / `\n`; double inner quotes per RFC 4180.
 *
 * Exposed for direct unit testing.
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Build a CSV line (with trailing `\r\n` per RFC 4180). */
export function csvRow(values: unknown[]): string {
  return values.map(csvEscape).join(',') + '\r\n';
}
