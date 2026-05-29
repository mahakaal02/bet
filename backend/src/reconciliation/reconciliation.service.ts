import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ReconciliationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../foundation/audit-log.service';
import { clampPageLimit, cursorPage } from '../common/pagination';

/**
 * Daily reconciliation (Roadmap §F-ADMIN-5).
 *
 * The auctions backend keeps a *local* `CoinTransaction` log for every
 * coin movement it drives (bid debits, purchase credits, refunds,
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
 * Performance: with ~50k active users, every user's local delta is
 * summed in ONE `groupBy` — not one `aggregate()` per user, which was
 * an N+1 of ~50k DB round-trips. Remote balances are still one Bet
 * call per user (Bet has no batch-balance endpoint yet), but we fan
 * them out in concurrent chunks of 25 rather than strictly serially,
 * which keeps the run comfortably inside the 5min cron window. At
 * 500k+ we'll want a batch endpoint on Bet's side; that's deferred to
 * the infra PR.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  static readonly BALANCE_FETCHER = Symbol('RECON_BALANCE_FETCHER');

  /** How many remote balance reads to run concurrently per chunk. */
  private static readonly BALANCE_CHUNK = 25;

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

    // One groupBy for every active user's whole-history delta, instead
    // of one aggregate() per user inside the loop (the old N+1).
    const localSums = await this.localSumsFor(active.map((a) => a.userId));

    let usersChecked = 0;
    let usersOk = 0;
    let usersDiscrepant = 0;
    let totalAbsDrift = 0;

    // Remote balances are unavoidably one Bet call per user. Fan them
    // out in bounded chunks so we neither run 50k strictly-serial calls
    // nor open 50k concurrent sockets. Counting/writes happen after each
    // chunk resolves, so the running totals stay race-free.
    for (const chunk of ReconciliationService.chunk(active, ReconciliationService.BALANCE_CHUNK)) {
      const results = await Promise.all(
        chunk.map(async ({ userId }) => {
          const localSum = localSums.get(userId) ?? 0;
          try {
            const remoteSum = await this.balanceFetcher.fetch(userId);
            return { userId, localSum, remoteSum, ok: true as const };
          } catch (err) {
            return { userId, localSum, error: (err as Error).message, ok: false as const };
          }
        }),
      );

      for (const r of results) {
        usersChecked += 1;
        if (!r.ok) {
          // A single user-balance failure shouldn't abort the whole run.
          // Log + count as discrepant so the admin notices.
          this.logger.warn(`balance fetch failed for ${r.userId}: ${r.error}`);
          await this.prisma.reconciliationDiscrepancy.create({
            data: {
              reportId,
              userId: r.userId,
              localSum: r.localSum,
              remoteSum: 0,
              drift: 0,
              notes: `balance_fetch_failed: ${r.error}`.slice(0, 500),
            },
          });
          usersDiscrepant += 1;
          continue;
        }
        const drift = r.localSum - r.remoteSum;
        if (drift === 0) {
          usersOk += 1;
          continue;
        }
        usersDiscrepant += 1;
        totalAbsDrift += Math.abs(drift);
        await this.prisma.reconciliationDiscrepancy.create({
          data: { reportId, userId: r.userId, localSum: r.localSum, remoteSum: r.remoteSum, drift },
        });
      }
    }

    return { usersChecked, usersOk, usersDiscrepant, totalAbsDrift };
  }

  /**
   * Whole-history `SUM(delta)` for a set of users in a single groupBy.
   * Users with no rows simply won't appear in the map (callers treat a
   * miss as 0). Wrapped so the test mock can intercept.
   */
  async localSumsFor(userIds: string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    const grouped = await this.prisma.coinTransaction.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds } },
      _sum: { delta: true },
    });
    return new Map(grouped.map((g) => [g.userId, g._sum.delta ?? 0]));
  }

  private static chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  // ─── Admin REST ──────────────────────────────────────────────────

  async listReports(input: { limit?: number; cursor?: string }) {
    const take = clampPageLimit(input.limit, 30, 60);
    const rows = await this.prisma.reconciliationReport.findMany({
      orderBy: [{ forDate: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(input.cursor ? { skip: 1, cursor: { id: input.cursor } } : {}),
    });
    const { page, nextCursor } = cursorPage(rows, take);
    return { items: page, nextCursor };
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
