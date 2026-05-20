import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  OutboxKind,
  OutboxStatus,
  Prisma,
  type Outbox,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  OUTBOX_DISPATCHER_REGISTRY,
  type OutboxDispatcher,
  type DispatchResult,
} from './outbox-dispatcher';

/**
 * Outbox service — enqueue and dispatch cross-service side effects
 * with at-least-once + idempotent semantics.
 *
 *   - `enqueue()` writes a PENDING row inside the caller's Prisma
 *     transaction. The business write + the side-effect intent
 *     atomically commit together. No "we wrote the bid but lost
 *     the wallet debit" failure mode.
 *
 *   - `dispatchPending()` (called by `OutboxWorker` every 500 ms)
 *     claims up to N PENDING-or-RETRY rows whose `nextAttemptAt
 *     <= now()`, flips them to IN_FLIGHT, fires the side effect
 *     via the per-kind `OutboxDispatcher` registry, then marks
 *     COMPLETED on success or schedules a retry with exponential
 *     backoff on failure. Six retries → DEAD.
 *
 *   - DEAD rows are surfaced by the observability layer (Grafana
 *     query + Slack alert).
 *
 * Backoff schedule: 30 s, 2 m, 10 m, 30 m, 2 h, 12 h. Permanent
 * (4xx) failures from the receiving service short-circuit to DEAD
 * on the first attempt — see `DispatchResult.permanent`.
 *
 * Concurrency: claim uses `SELECT … FOR UPDATE SKIP LOCKED` so
 * multiple workers across pods can drain the same outbox without
 * stepping on each other.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  private static readonly BACKOFF_MS = [
    30_000,                                       // 30s
    120_000,                                      // 2m
    600_000,                                      // 10m
    1_800_000,                                    // 30m
    7_200_000,                                    // 2h
    43_200_000,                                   // 12h
  ];
  /**
   * Max attempts before going DEAD. Six backoff slots × 1 retry each
   * = 6 retries after the initial attempt = 7 total tries before
   * declaring permanent failure. Matches the "six retries → DEAD"
   * intent of the docs above.
   */
  private static readonly MAX_ATTEMPTS = 7;
  /**
   * IN_FLIGHT rows older than this are considered orphaned (the
   * worker that claimed them crashed mid-flight) and reclaimed by
   * the next batch claim. 5 minutes is long enough that a slow
   * but live dispatcher isn't double-fired, short enough that a
   * crash doesn't strand work for hours.
   */
  private static readonly STUCK_AFTER_MS = 5 * 60_000;

  constructor(
    private readonly prisma: PrismaService,
    /**
     * Per-kind dispatcher registry. Injection token resolved by
     * `OutboxModule` (or any module that contributes a
     * dispatcher) — see `outbox-dispatcher.ts` for the contract.
     *
     * Optional because the foundation alone can't fire side
     * effects (the registry contributors live in feature modules).
     * When unwired, `dispatchPending()` short-circuits with zero
     * work done.
     */
    @Optional()
    @Inject(OUTBOX_DISPATCHER_REGISTRY)
    private readonly dispatchers: OutboxDispatcher[] | undefined,
  ) {}

  /**
   * MUST be called inside the same Prisma transaction as the
   * business write that triggers the side effect, so the outbox
   * row either commits with the business write or rolls back
   * with it. Pass `tx` from `prisma.$transaction(async tx => ...)`,
   * or — for callers that don't yet wrap their write in a
   * transaction — pass the global `PrismaService` and accept the
   * weaker (still safe at-least-once) guarantee.
   */
  async enqueue(
    tx: Prisma.TransactionClient | PrismaService,
    input: {
      kind: OutboxKind;
      sourceTable: string;                      // e.g. "Bid"
      sourceId: string;                         // e.g. "abc123"
      payload: Record<string, unknown>;
      idempotencyKey: string;                   // sent verbatim to the receiver
    },
  ) {
    return tx.outbox.create({
      data: {
        kind: input.kind,
        sourceTable: input.sourceTable,
        sourceId: input.sourceId,
        payload: input.payload as Prisma.InputJsonValue,
        idempotencyKey: input.idempotencyKey,
        status: OutboxStatus.PENDING,
        nextAttemptAt: new Date(),
      },
    });
  }

  /**
   * Worker entry point. Claims a batch, dispatches each row,
   * advances row status. Returns the number of rows processed so
   * the worker can adapt poll cadence (back off when idle, speed
   * up when hot).
   */
  async dispatchPending(batchSize = 50): Promise<number> {
    if (!this.dispatchers || this.dispatchers.length === 0) {
      // No dispatchers registered → no rows can be progressed.
      // This is the foundation-only configuration; feature modules
      // contribute dispatchers as they ship.
      return 0;
    }

    const rows = await this.claimBatch(batchSize);
    if (rows.length === 0) return 0;
    this.logger.debug(`outbox: dispatching ${rows.length} row(s)`);

    // Build a {kind → dispatcher} lookup once per batch.
    const byKind = new Map<OutboxKind, OutboxDispatcher>();
    for (const d of this.dispatchers) byKind.set(d.kind, d);

    let processed = 0;
    for (const row of rows) {
      const dispatcher = byKind.get(row.kind);
      if (!dispatcher) {
        await this.markRetry(row, `no dispatcher registered for kind=${row.kind}`);
        continue;
      }
      try {
        const result = await dispatcher.dispatch(row);
        if (result.ok) {
          await this.markCompleted(row);
          processed++;
        } else if (result.permanent) {
          await this.markDead(row, result.error ?? 'permanent failure (4xx)');
        } else {
          await this.scheduleRetry(row, result.error ?? 'transient failure');
        }
      } catch (e) {
        // Unhandled dispatcher exception — treat as transient.
        await this.scheduleRetry(row, (e as Error).message);
      }
    }
    return processed;
  }

  /**
   * Atomically claim a batch. Single UPDATE moves rows from
   * PENDING/RETRY into IN_FLIGHT and stamps the attempt count.
   * Other workers that hit the same SELECT see SKIP LOCKED so
   * no two pods claim the same row.
   *
   * We also reclaim "stuck" IN_FLIGHT rows (older than
   * STUCK_AFTER_MS) — that handles the case where a worker
   * crashed between claiming and updating.
   */
  private async claimBatch(limit: number): Promise<Outbox[]> {
    const now = new Date();
    const stuckCutoff = new Date(now.getTime() - OutboxService.STUCK_AFTER_MS);

    // Single raw UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED).
    // Prisma's query builder doesn't expose FOR UPDATE; this is
    // one of the rare "must be SQL" spots.
    const claimed = await this.prisma.$queryRaw<Outbox[]>`
      UPDATE "Outbox"
      SET
        "status" = 'IN_FLIGHT',
        "attempts" = "attempts" + 1
      WHERE id IN (
        SELECT id
        FROM "Outbox"
        WHERE
          (
            ("status" IN ('PENDING', 'RETRY') AND "nextAttemptAt" <= ${now})
            OR
            ("status" = 'IN_FLIGHT' AND "nextAttemptAt" < ${stuckCutoff})
          )
        ORDER BY "nextAttemptAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *;
    `;
    return claimed;
  }

  private async markCompleted(row: Outbox) {
    await this.prisma.outbox.update({
      where: { id: row.id },
      data: {
        status: OutboxStatus.COMPLETED,
        completedAt: new Date(),
        lastError: null,
      },
    });
  }

  private async scheduleRetry(row: Outbox, reason: string) {
    if (OutboxService.isDead(row.attempts)) {
      await this.markDead(row, reason);
      return;
    }
    const next = OutboxService.nextAttemptAt(row.attempts);
    await this.prisma.outbox.update({
      where: { id: row.id },
      data: {
        status: OutboxStatus.PENDING,                // back to PENDING so claim picks it up
        nextAttemptAt: next,
        lastError: reason.slice(0, 500),
      },
    });
  }

  private async markRetry(row: Outbox, reason: string) {
    await this.scheduleRetry(row, reason);
  }

  private async markDead(row: Outbox, reason: string) {
    await this.prisma.outbox.update({
      where: { id: row.id },
      data: {
        status: OutboxStatus.DEAD,
        lastError: reason.slice(0, 500),
      },
    });
    this.logger.error(`outbox row ${row.id} (kind=${row.kind}) DEAD: ${reason}`);
  }

  /**
   * Compute the next retry timestamp given the current attempt
   * count. Pure helper — heavily unit-tested.
   *
   * `attemptsSoFar` is the count AFTER the failing attempt
   * (claim increments first, then dispatcher runs). So
   * `attemptsSoFar=1` means "this was the first attempt and it
   * failed — schedule attempt #2 in 30s".
   */
  static nextAttemptAt(attemptsSoFar: number, now = new Date()): Date {
    const idx = Math.min(
      Math.max(0, attemptsSoFar - 1),
      OutboxService.BACKOFF_MS.length - 1,
    );
    const wait = OutboxService.BACKOFF_MS[idx];
    return new Date(now.getTime() + wait);
  }

  static isDead(attemptsSoFar: number): boolean {
    return attemptsSoFar >= OutboxService.MAX_ATTEMPTS;
  }

  /** Inspector — admin UI calls this to surface the outbox state. */
  async stats(): Promise<Record<OutboxStatus, number>> {
    const rows = await this.prisma.outbox.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const out: Record<string, number> = {
      PENDING: 0,
      IN_FLIGHT: 0,
      COMPLETED: 0,
      FAILED: 0,
      DEAD: 0,
    };
    for (const r of rows) out[r.status] = r._count._all;
    return out as Record<OutboxStatus, number>;
  }
}

/**
 * Result of a single dispatcher run.
 *
 *   ok=true                  → mark COMPLETED, no retry.
 *   ok=false, permanent=true → mark DEAD on the first failure
 *                              (4xx, validation errors, etc.).
 *   ok=false, permanent=false → schedule retry with backoff.
 *
 * Used by feature-module dispatchers — see
 * `notifications/outbox-dispatchers/fcm-push.dispatcher.ts` or
 * `bids/outbox-dispatchers/bet-wallet-debit.dispatcher.ts`.
 */
export type { DispatchResult };
