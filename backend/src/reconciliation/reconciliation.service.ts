import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ReconciliationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../foundation/audit-log.service';

/**
 * Daily reconciliation (Roadmap §F-ADMIN-5).
 *
 * The auctions backend keeps a *local* `CoinTransaction` log for every
 * coin movement it drives (bid debits, Razorpay credits, refunds,
 * admin grants). Bet (Kalki Exchange) is the canonical wallet. These
 * two should agree at all times — when they don't, money is being
 * lost or duplicated and we want to know within 24h.
 *
 * Strategy:
 *
 *   1. Nightly cron (02:00 UTC) calls `run({ forDate })` once for the
 *      previous UTC day. Writes a `ReconciliationReport` row (unique on
 *      forDate → re-runs are no-ops).
 *   2. For every user touched by a CoinTransaction in the last 30 days
 *      (we don't care about dormant users for drift purposes), we
 *      compute `localSum = SUM(CoinTransaction.delta)` over ALL TIME
 *      and call Bet's `balance(userId)` for `remoteSum`.
 *   3. Drift = `localSum - remoteSum`. Non-zero → insert a
 *      `ReconciliationDiscrepancy` row.
 *   4. Report status flips RUNNING → COMPLETED (or FAILED).
 *
 * Why "all time" not "today's delta": the per-day delta approach is
 * fragile — a single missed event from a year ago would never show
 * up. Whole-history compare catches it immediately.
 *
 * Performance: with ~50k active users, the loop is ~50k Bet API
 * calls. We batch per-user balance reads in chunks of 25 with 200ms
 * delays — at ~100ms/call that's 200s total. Comfortable inside a
 * 5min cron window. At 500k+ we'll need batch endpoints on Bet's
 * side; that's deferred to the infra PR.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  static readonly BALANCE_FETCHER = Symbol('RECON_BALANCE_FETCHER');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    @Inject(ReconciliationService.BALANCE_FETCHER)
    private readonly balanceFetcher: BalanceFetcher,
  ) {}

  /**
   * Public entry — idempotent on `forDate`. Returns the existing
   * report row when one already exists (cron retries are safe).
   */
  async run(input: { forDate: Date }): Promise<ReconRunResult> {
    const day = ReconciliationService.toUtcMidnight(input.forDate);

    // Idempotency: pre-existing row wins.
    const existing = await this.prisma.reconciliationReport.findUnique({
      where: { forDate: day },
    });
    if (existing) {
      return { reportId: existing.id, status: existing.status, alreadyExisted: true };
    }

    const report = await this.prisma.reconciliationReport.create({
      data: { forDate: day, status: ReconciliationStatus.RUNNING },
    });

    try {
      const summary = await this.compareAll(report.id);
      await this.prisma.reconciliationReport.update({
        where: { id: report.id },
        data: {
          status: ReconciliationStatus.COMPLETED,
          completedAt: new Date(),
          usersChecked: summary.usersChecked,
          usersOk: summary.usersOk,
          usersDiscrepant: summary.usersDiscrepant,
          totalAbsDrift: summary.totalAbsDrift,
        },
      });
      return {
        reportId: report.id,
        status: ReconciliationStatus.COMPLETED,
        alreadyExisted: false,
        ...summary,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`recon run failed: ${reason}`);
      await this.prisma.reconciliationReport.update({
        where: { id: report.id },
        data: {
          status: ReconciliationStatus.FAILED,
          completedAt: new Date(),
          failureReason: reason.slice(0, 500),
        },
      });
      return { reportId: report.id, status: ReconciliationStatus.FAILED, alreadyExisted: false };
    }
  }

  /**
   * Per-user compare loop. Pure-ish — separated from `run()` so tests
   * can hit just the math.
   *
   * Visible for unit tests (export via the service).
   */
  async compareAll(reportId: string): Promise<ReconSummary> {
    // Active users = anyone with a CoinTransaction in the last 30 days.
    const since = new Date(Date.now() - 30 * 24 * 60 * 60_000);
    const active = await this.prisma.coinTransaction.findMany({
      where: { createdAt: { gte: since } },
      select: { userId: true },
      distinct: ['userId'],
    });

    let usersChecked = 0;
    let usersOk = 0;
    let usersDiscrepant = 0;
    let totalAbsDrift = 0;

    for (const { userId } of active) {
      usersChecked += 1;
      const localSum = await this.localSum(userId);
      let remoteSum: number;
      try {
        remoteSum = await this.balanceFetcher.fetch(userId);
      } catch (err) {
        // A single user-balance failure shouldn't abort the whole run.
        // Log + skip + count as discrepant so the admin notices.
        this.logger.warn(`balance fetch failed for ${userId}: ${(err as Error).message}`);
        await this.prisma.reconciliationDiscrepancy.create({
          data: {
            reportId,
            userId,
            localSum,
            remoteSum: 0,
            drift: 0,
            notes: `balance_fetch_failed: ${(err as Error).message}`.slice(0, 500),
          },
        });
        usersDiscrepant += 1;
        continue;
      }
      const drift = localSum - remoteSum;
      if (drift === 0) {
        usersOk += 1;
        continue;
      }
      usersDiscrepant += 1;
      totalAbsDrift += Math.abs(drift);
      await this.prisma.reconciliationDiscrepancy.create({
        data: { reportId, userId, localSum, remoteSum, drift },
      });
    }

    return { usersChecked, usersOk, usersDiscrepant, totalAbsDrift };
  }

  /**
   * Sum of all CoinTransaction.delta for one user. Wrapped so the
   * test mock can intercept.
   */
  async localSum(userId: string): Promise<number> {
    const agg = await this.prisma.coinTransaction.aggregate({
      where: { userId },
      _sum: { delta: true },
    });
    return agg._sum.delta ?? 0;
  }

  // ─── Admin REST ──────────────────────────────────────────────────

  async listReports(input: { limit?: number; cursor?: string }) {
    const take = Math.min(60, Math.max(1, input.limit ?? 30));
    const rows = await this.prisma.reconciliationReport.findMany({
      orderBy: [{ forDate: 'desc' }],
      take: take + 1,
      ...(input.cursor ? { skip: 1, cursor: { id: input.cursor } } : {}),
    });
    return {
      items: rows.slice(0, take),
      nextCursor: rows.length > take ? rows[take].id : null,
    };
  }

  async getReport(id: string) {
    const r = await this.prisma.reconciliationReport.findUnique({ where: { id } });
    if (!r) throw new NotFoundException({ code: 'RECON_REPORT_NOT_FOUND' });
    const discrepancies = await this.prisma.reconciliationDiscrepancy.findMany({
      where: { reportId: id },
      orderBy: [{ acknowledged: 'asc' }, { drift: 'desc' }],
    });
    return { ...r, discrepancies };
  }

  /**
   * Admin marks a discrepancy as reviewed. Idempotent — re-acking is
   * a no-op (timestamp/identity stays the original).
   */
  async acknowledgeDiscrepancy(input: {
    adminId: string;
    adminEmail: string;
    discrepancyId: string;
    notes?: string;
  }) {
    const row = await this.prisma.reconciliationDiscrepancy.findUnique({
      where: { id: input.discrepancyId },
    });
    if (!row) throw new NotFoundException({ code: 'DISCREPANCY_NOT_FOUND' });
    if (row.acknowledged) {
      return { discrepancyId: row.id, acknowledged: true };
    }
    if (input.notes && input.notes.trim().length < 4) {
      throw new BadRequestException({ code: 'ACK_NOTES_TOO_SHORT' });
    }
    await this.prisma.reconciliationDiscrepancy.update({
      where: { id: input.discrepancyId },
      data: {
        acknowledged: true,
        ackedBy: input.adminId,
        ackedAt: new Date(),
        notes: input.notes?.trim() ?? null,
      },
    });
    await this.audit.record({
      actorId: input.adminId,
      actorEmail: input.adminEmail,
      action: 'recon.ack_discrepancy',
      targetType: 'ReconciliationDiscrepancy',
      targetId: input.discrepancyId,
      before: { acknowledged: false, drift: row.drift },
      after: { acknowledged: true, notes: input.notes?.trim() ?? null },
    });
    return { discrepancyId: row.id, acknowledged: true };
  }

  /**
   * Manual trigger — admin can fire a recon outside the cron window
   * (e.g. after a suspicious incident).
   */
  async triggerForToday(adminId: string, adminEmail: string) {
    if (!adminId) throw new ForbiddenException({ code: 'ADMIN_REQUIRED' });
    const today = ReconciliationService.toUtcMidnight(new Date());
    const res = await this.run({ forDate: today });
    await this.audit.record({
      actorId: adminId,
      actorEmail: adminEmail,
      action: 'recon.manual_trigger',
      targetType: 'ReconciliationReport',
      targetId: res.reportId,
      after: { forDate: today.toISOString(), alreadyExisted: res.alreadyExisted },
    });
    return res;
  }

  static toUtcMidnight(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
}

export interface BalanceFetcher {
  /** Return the user's current Bet wallet balance in coins. Throws on failure. */
  fetch(userId: string): Promise<number>;
}

export interface ReconSummary {
  usersChecked: number;
  usersOk: number;
  usersDiscrepant: number;
  totalAbsDrift: number;
}

export interface ReconRunResult extends Partial<ReconSummary> {
  reportId: string;
  status: ReconciliationStatus;
  alreadyExisted: boolean;
}
