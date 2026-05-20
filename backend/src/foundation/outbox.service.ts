import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, OutboxKind, OutboxStatus } from '@prisma/client';

/**
 * Outbox service — enqueue and (eventually) dispatch cross-service
 * side effects with at-least-once + idempotent semantics.
 *
 *   - `enqueue()` writes a PENDING row inside the caller's Prisma
 *     transaction. The business write + the side-effect intent
 *     atomically commit together — no "we wrote the bid but lost the
 *     wallet debit" failure mode.
 *
 *   - `dispatchPending()` (called by the BullMQ worker on a 500ms
 *     poll) claims a batch of up-to-50 PENDING rows whose
 *     `nextAttemptAt <= now()`, flips them to IN_FLIGHT, fires the
 *     side effect, then marks COMPLETED on success or schedules a
 *     retry with exponential backoff on failure. 6 retries → DEAD.
 *
 *   - DEAD rows page on-call (handled in observability layer).
 *
 * Backoff schedule: 30s, 2m, 10m, 30m, 2h, 12h. Permanent (4xx)
 * failures from the receiving service short-circuit to DEAD on the
 * first attempt.
 *
 * Skeleton — Foundation PR ships `enqueue()` and the contract for
 * `dispatchPending()`. The dispatch loop + per-kind adapters
 * (BetWallet, FCM, SES, Razorpay) wire in PR-OUTBOX-1.
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
  private static readonly MAX_ATTEMPTS = 6;

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * MUST be called inside the same Prisma transaction as the
   * business write that triggers the side effect — so the outbox
   * row either commits with the business write or rolls back with
   * it. Never call this from a separate transaction or you've
   * unset the consistency guarantee.
   */
  async enqueue(
    tx: Pick<PrismaClient, 'outbox'>,                // tx-bound client
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
        payload: input.payload as object,
        idempotencyKey: input.idempotencyKey,
        status: OutboxStatus.PENDING,
        nextAttemptAt: new Date(),
      },
    });
  }

  /**
   * Worker entry point. Returns the count of rows processed in this
   * batch so the worker can adjust polling cadence (back off when
   * idle, speed up when queue is hot).
   *
   * Each row goes through:
   *   1. SELECT … FOR UPDATE SKIP LOCKED (prevents two workers
   *      claiming the same row).
   *   2. UPDATE status=IN_FLIGHT, attempts+=1.
   *   3. Dispatch by kind to the adapter.
   *   4. On success: UPDATE status=COMPLETED, completedAt=now().
   *   5. On retryable failure: schedule next attempt; if attempts
   *      >= MAX, status=DEAD.
   *
   * Stub — the wiring of the adapter selection + batched UPDATE is
   * the deliverable of PR-OUTBOX-1. We expose the contract here so
   * downstream code can already write outbox rows.
   */
  async dispatchPending(_batchSize = 50): Promise<number> {
    // TODO (PR-OUTBOX-1): implement dispatch loop.
    return 0;
  }

  /**
   * Compute the next retry timestamp given the current attempt
   * count. Pure helper — tested in unit tests.
   */
  static nextAttemptAt(attemptsSoFar: number, now = new Date()): Date {
    const idx = Math.min(attemptsSoFar, OutboxService.BACKOFF_MS.length - 1);
    const wait = OutboxService.BACKOFF_MS[idx];
    return new Date(now.getTime() + wait);
  }

  static isDead(attemptsSoFar: number): boolean {
    return attemptsSoFar >= OutboxService.MAX_ATTEMPTS;
  }
}
