import { BadRequestException, Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Perm, PermsGuard } from '../admin/perms.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { CsvExportService } from './csv-export.service';

/**
 * Admin CSV export endpoints. Each route streams the response — we
 * never load the full dataset into memory.
 *
 *   GET /admin/csv/audit-log?from=ISO&to=ISO
 *   GET /admin/csv/coin-transactions?from=ISO&to=ISO
 *   GET /admin/csv/orders?from=ISO&to=ISO
 *
 * Returns text/csv with a friendly Content-Disposition filename
 * (`<resource>-<ts>.csv`). Permissions are pinned per-resource —
 * audit log via `audit.view`, ledger via `ledger.export`, orders via
 * `withdrawal.view` (ops-tier).
 */
@UseGuards(JwtAuthGuard, PermsGuard)
@Controller('admin/csv')
export class CsvExportController {
  constructor(private readonly svc: CsvExportService) {}

  @Get('audit-log')
  @Perm('audit.view')
  async auditLog(
    @CurrentUser() user: AuthedUser,
    @Res({ passthrough: false }) res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    await this.stream(
      res,
      'audit-log',
      this.svc.exportAuditLog({ from: parseDate(from), to: parseDate(to) }),
      { adminId: user.id, adminEmail: user.email ?? '', from, to },
    );
  }

  @Get('coin-transactions')
  @Perm('ledger.export')
  async coinTransactions(
    @CurrentUser() user: AuthedUser,
    @Res({ passthrough: false }) res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    await this.stream(
      res,
      'coin-transactions',
      this.svc.exportCoinTransactions({ from: parseDate(from), to: parseDate(to) }),
      { adminId: user.id, adminEmail: user.email ?? '', from, to },
    );
  }

  @Get('orders')
  @Perm('withdrawal.view')
  async orders(
    @CurrentUser() user: AuthedUser,
    @Res({ passthrough: false }) res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    await this.stream(
      res,
      'orders',
      this.svc.exportOrders({ from: parseDate(from), to: parseDate(to) }),
      { adminId: user.id, adminEmail: user.email ?? '', from, to },
    );
  }

  private async stream(
    res: Response,
    resource: string,
    gen: AsyncGenerator<string>,
    auditInput: { adminId: string; adminEmail: string; from?: string; to?: string },
  ) {
    const filename = `${resource}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store, private');

    // Excel-friendly: prepend a BOM so cells with non-ASCII (₹, Hindi
    // characters in display names) render correctly in Windows Excel.
    res.write('﻿');

    let rowCount = 0;
    try {
      for await (const line of gen) {
        rowCount += 1;
        res.write(line);
      }
    } catch (err) {
      // Mid-stream errors can't change headers — write a trailer line
      // the operator will notice on inspection.
      res.write(`# EXPORT FAILED: ${(err as Error).message}\r\n`);
    }
    res.end();
    await this.svc.recordExport({
      adminId: auditInput.adminId,
      adminEmail: auditInput.adminEmail,
      resource,
      rowCount: Math.max(0, rowCount - 1),  // -1 for header
      from: parseDate(auditInput.from),
      to: parseDate(auditInput.to),
    });
  }
}

function parseDate(s?: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException({ code: 'INVALID_DATE', value: s });
  }
  return d;
}
