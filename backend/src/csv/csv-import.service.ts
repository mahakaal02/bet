import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../foundation/audit-log.service';
import { parseCsv } from './csv-parser';

/**
 * Bulk admin import (Roadmap §F-ADMIN-10).
 *
 * Two surface importers today:
 *
 *   1. CoinPack — `id?,coins,priceInr,active?,sortOrder?`
 *      Upsert-by-id when provided, insert-new when blank.
 *   2. Auction lineup — `title,description,retailPrice,coinsPerBid,
 *      endsAtIso,startsAtIso?,manipulationMode?`
 *      Always insert (auctions are append-only).
 *
 * Two-phase import:
 *
 *   1. **Dry run** (default) — parse the CSV, validate every row,
 *      return per-row outcomes WITHOUT writing. Lets the admin
 *      review the diff before committing.
 *   2. **Commit** — re-parse, validate, write inside a single
 *      transaction so partial failures roll back.
 *
 * Validation strategy: each importer owns a `validateRow()` that
 * returns `{ ok: true, value }` or `{ ok: false, errors: [string] }`.
 * Errors are collected per-row; the import refuses to commit if ANY
 * row is invalid. No "partial commit" mode — the admin's mental
 * model of "I uploaded X rows, X rows landed" stays clean.
 *
 * Row cap: 10k rows per import. Above that we ask for a smaller
 * chunk (or a proper background-job runner — out of scope here).
 */

export interface ImportRowResult {
  row: number;          // 1-based, header is row 1
  status: 'ok' | 'error';
  errors?: string[];
  action?: 'created' | 'updated' | 'skipped';
  payload?: Record<string, unknown>;
}

export interface ImportSummary {
  dryRun: boolean;
  resource: string;
  totalRows: number;
  okRows: number;
  errorRows: number;
  rows: ImportRowResult[];
}

@Injectable()
export class CsvImportService {
  private readonly logger = new Logger(CsvImportService.name);
  static readonly MAX_ROWS = 10_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // ─── Coin packs ──────────────────────────────────────────────

  async importCoinPacks(input: {
    adminId: string;
    adminEmail: string;
    csvText: string;
    dryRun: boolean;
  }): Promise<ImportSummary> {
    const { headers, rows } = parseCsv(input.csvText);
    const required = ['coins', 'priceInr'];
    this.assertHeaders(headers, required);
    this.assertRowCount(rows.length);

    const parsed: ImportRowResult[] = rows.map((r, i) =>
      this.validateCoinPackRow(headers, r, i + 2 /* header is row 1 */),
    );

    const hasErrors = parsed.some((p) => p.status === 'error');
    if (input.dryRun || hasErrors) {
      return this.summarise(parsed, 'coin-packs', input.dryRun || hasErrors);
    }

    // Commit phase — one transaction so partial failures don't write.
    await this.prisma.$transaction(async (tx) => {
      for (const r of parsed) {
        const data = r.payload as {
          id?: string; coins: number; priceInr: number; active: boolean; sortOrder: number;
        };
        if (data.id) {
          await tx.coinPack.upsert({
            where: { id: data.id },
            create: {
              id: data.id,
              coins: data.coins,
              priceInr: new Prisma.Decimal(data.priceInr),
              active: data.active,
              sortOrder: data.sortOrder,
            },
            update: {
              coins: data.coins,
              priceInr: new Prisma.Decimal(data.priceInr),
              active: data.active,
              sortOrder: data.sortOrder,
            },
          });
          r.action = 'updated';
        } else {
          await tx.coinPack.create({
            data: {
              coins: data.coins,
              priceInr: new Prisma.Decimal(data.priceInr),
              active: data.active,
              sortOrder: data.sortOrder,
            },
          });
          r.action = 'created';
        }
      }
    });

    await this.audit.record({
      actorId: input.adminId,
      actorEmail: input.adminEmail,
      action: 'csv.import',
      targetType: 'CoinPack',
      targetId: 'bulk',
      after: { rowCount: parsed.length, dryRun: false },
    });
    return this.summarise(parsed, 'coin-packs', false);
  }

  // ─── Auctions ────────────────────────────────────────────────

  async importAuctions(input: {
    adminId: string;
    adminEmail: string;
    csvText: string;
    dryRun: boolean;
  }): Promise<ImportSummary> {
    const { headers, rows } = parseCsv(input.csvText);
    const required = ['title', 'description', 'retailPrice', 'coinsPerBid', 'endsAtIso'];
    this.assertHeaders(headers, required);
    this.assertRowCount(rows.length);

    const parsed: ImportRowResult[] = rows.map((r, i) =>
      this.validateAuctionRow(headers, r, i + 2),
    );

    const hasErrors = parsed.some((p) => p.status === 'error');
    if (input.dryRun || hasErrors) {
      return this.summarise(parsed, 'auctions', input.dryRun || hasErrors);
    }

    await this.prisma.$transaction(async (tx) => {
      for (const r of parsed) {
        const d = r.payload as {
          title: string;
          description: string;
          retailPrice: number;
          coinsPerBid: number;
          endsAt: Date;
          startsAt?: Date;
          manipulationMode: 'NORMAL' | 'NO_WINNER' | 'FIXED_WINNER';
        };
        await tx.auction.create({
          data: {
            title: d.title,
            description: d.description,
            retailPrice: new Prisma.Decimal(d.retailPrice),
            coinsPerBid: d.coinsPerBid,
            endsAt: d.endsAt,
            startsAt: d.startsAt ?? null,
            manipulationMode: d.manipulationMode,
          },
        });
        r.action = 'created';
      }
    });

    await this.audit.record({
      actorId: input.adminId,
      actorEmail: input.adminEmail,
      action: 'csv.import',
      targetType: 'Auction',
      targetId: 'bulk',
      after: { rowCount: parsed.length, dryRun: false },
    });
    return this.summarise(parsed, 'auctions', false);
  }

  // ─── Validation helpers ──────────────────────────────────────

  private validateCoinPackRow(headers: string[], row: string[], rowNum: number): ImportRowResult {
    const errors: string[] = [];
    const get = (col: string) => {
      const idx = headers.indexOf(col);
      return idx >= 0 ? row[idx] : undefined;
    };

    const id = (get('id') ?? '').trim() || undefined;
    const coinsRaw = (get('coins') ?? '').trim();
    const priceRaw = (get('priceInr') ?? '').trim();
    const activeRaw = (get('active') ?? 'true').trim().toLowerCase();
    const sortRaw = (get('sortOrder') ?? '0').trim();

    const coins = Number(coinsRaw);
    if (!Number.isInteger(coins) || coins <= 0) errors.push(`coins must be a positive integer (got ${coinsRaw})`);

    const priceInr = Number(priceRaw);
    if (!Number.isFinite(priceInr) || priceInr <= 0) errors.push(`priceInr must be > 0 (got ${priceRaw})`);

    if (activeRaw !== 'true' && activeRaw !== 'false') {
      errors.push(`active must be "true" or "false" (got "${activeRaw}")`);
    }

    const sortOrder = Number(sortRaw);
    if (!Number.isInteger(sortOrder)) errors.push(`sortOrder must be an integer (got ${sortRaw})`);

    if (errors.length > 0) {
      return { row: rowNum, status: 'error', errors };
    }
    return {
      row: rowNum,
      status: 'ok',
      payload: { id, coins, priceInr, active: activeRaw === 'true', sortOrder },
    };
  }

  private validateAuctionRow(headers: string[], row: string[], rowNum: number): ImportRowResult {
    const errors: string[] = [];
    const get = (col: string) => {
      const idx = headers.indexOf(col);
      return idx >= 0 ? row[idx] : undefined;
    };

    const title = (get('title') ?? '').trim();
    if (title.length < 3) errors.push('title must be at least 3 chars');
    if (title.length > 200) errors.push('title must be ≤ 200 chars');

    const description = (get('description') ?? '').trim();
    if (description.length < 10) errors.push('description must be at least 10 chars');

    const retailPrice = Number((get('retailPrice') ?? '').trim());
    if (!Number.isFinite(retailPrice) || retailPrice <= 0) errors.push('retailPrice must be > 0');

    const coinsPerBid = Number((get('coinsPerBid') ?? '').trim());
    if (!Number.isInteger(coinsPerBid) || coinsPerBid <= 0) errors.push('coinsPerBid must be a positive integer');

    const endsAtRaw = (get('endsAtIso') ?? '').trim();
    const endsAt = new Date(endsAtRaw);
    if (Number.isNaN(endsAt.getTime())) errors.push(`endsAtIso must be parseable ISO (got "${endsAtRaw}")`);

    const startsAtRaw = (get('startsAtIso') ?? '').trim();
    let startsAt: Date | undefined;
    if (startsAtRaw) {
      startsAt = new Date(startsAtRaw);
      if (Number.isNaN(startsAt.getTime())) errors.push(`startsAtIso must be parseable ISO (got "${startsAtRaw}")`);
      if (startsAt && endsAt.getTime() <= startsAt.getTime()) errors.push('endsAtIso must be after startsAtIso');
    }

    const modeRaw = ((get('manipulationMode') ?? 'NORMAL').trim().toUpperCase()) as
      'NORMAL' | 'NO_WINNER' | 'FIXED_WINNER';
    if (!['NORMAL', 'NO_WINNER', 'FIXED_WINNER'].includes(modeRaw)) {
      errors.push(`manipulationMode must be NORMAL / NO_WINNER / FIXED_WINNER (got ${modeRaw})`);
    }

    if (errors.length > 0) {
      return { row: rowNum, status: 'error', errors };
    }
    return {
      row: rowNum,
      status: 'ok',
      payload: {
        title, description, retailPrice, coinsPerBid,
        endsAt, startsAt, manipulationMode: modeRaw,
      },
    };
  }

  // ─── Generic helpers ─────────────────────────────────────────

  private assertHeaders(headers: string[], required: string[]) {
    const missing = required.filter((r) => !headers.includes(r));
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'CSV_HEADER_MISSING',
        missing,
      });
    }
  }

  private assertRowCount(count: number) {
    if (count === 0) throw new BadRequestException({ code: 'CSV_EMPTY' });
    if (count > CsvImportService.MAX_ROWS) {
      throw new BadRequestException({
        code: 'CSV_TOO_MANY_ROWS',
        max: CsvImportService.MAX_ROWS,
        got: count,
      });
    }
  }

  private summarise(rows: ImportRowResult[], resource: string, dryRun: boolean): ImportSummary {
    return {
      dryRun,
      resource,
      totalRows: rows.length,
      okRows: rows.filter((r) => r.status === 'ok').length,
      errorRows: rows.filter((r) => r.status === 'error').length,
      rows,
    };
  }
}
