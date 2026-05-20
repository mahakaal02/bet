import { OutboxService } from './outbox.service';
import { OutboxKind, OutboxStatus, type Outbox } from '@prisma/client';
import type { OutboxDispatcher } from './outbox-dispatcher';

/**
 * OutboxService unit tests.
 *
 * Focuses on the parts that are most likely to introduce bugs:
 *   - Backoff schedule (off-by-one on attempt index)
 *   - Permanent-vs-transient classification
 *   - DEAD threshold
 *   - Dispatcher selection (unknown kind → retry, not crash)
 *   - dispatchPending short-circuits when no dispatchers registered
 *
 * The DB-level claim (`SELECT FOR UPDATE SKIP LOCKED`) is integration-
 * tested separately against a real Postgres in the e2e suite — this
 * file mocks Prisma so the unit tests run in <100 ms.
 */
describe('OutboxService', () => {
  describe('nextAttemptAt', () => {
    const NOW = new Date('2026-05-20T12:00:00Z');

    it('schedules attempt #2 30 s after attempt #1 fails', () => {
      const next = OutboxService.nextAttemptAt(1, NOW);
      expect(next.getTime() - NOW.getTime()).toBe(30_000);
    });

    it('schedules attempt #3 2 m after attempt #2 fails', () => {
      const next = OutboxService.nextAttemptAt(2, NOW);
      expect(next.getTime() - NOW.getTime()).toBe(120_000);
    });

    it('schedules attempt #6 2 h after attempt #5 fails', () => {
      // Six backoff slots, MAX_ATTEMPTS=7 → 6 retries after the
      // initial attempt. The 5th attempt's failure schedules the
      // 6th try at the 2-hour slot.
      const next = OutboxService.nextAttemptAt(5, NOW);
      expect(next.getTime() - NOW.getTime()).toBe(7_200_000);                // 2h
    });

    it('schedules the final retry 12 h after attempt #6 fails', () => {
      const next = OutboxService.nextAttemptAt(6, NOW);
      expect(next.getTime() - NOW.getTime()).toBe(43_200_000);               // 12h
    });

    it('caps at the longest backoff for high attempt counts', () => {
      // attemptsSoFar=99 would index past the array; we cap.
      const next = OutboxService.nextAttemptAt(99, NOW);
      expect(next.getTime() - NOW.getTime()).toBe(43_200_000);
    });

    it('treats attemptsSoFar=0 as the smallest backoff', () => {
      const next = OutboxService.nextAttemptAt(0, NOW);
      expect(next.getTime() - NOW.getTime()).toBe(30_000);
    });
  });

  describe('isDead', () => {
    it('returns true at MAX_ATTEMPTS', () => {
      expect(OutboxService.isDead(7)).toBe(true);
    });
    it('returns false below MAX_ATTEMPTS', () => {
      expect(OutboxService.isDead(6)).toBe(false);
      expect(OutboxService.isDead(0)).toBe(false);
    });
  });

  describe('dispatchPending', () => {
    function row(overrides: Partial<Outbox> = {}): Outbox {
      return {
        id: 'row-1',
        kind: OutboxKind.BET_WALLET_DEBIT,
        sourceTable: 'Bid',
        sourceId: 'bid-1',
        payload: { amount: 100 },
        idempotencyKey: 'key-1',
        status: OutboxStatus.IN_FLIGHT,
        attempts: 1,
        nextAttemptAt: new Date(),
        lastError: null,
        completedAt: null,
        createdAt: new Date(),
        ...overrides,
      } as Outbox;
    }

    it('returns 0 when no dispatchers are registered', async () => {
      const prismaMock = {
        $queryRaw: jest.fn(async () => []),
        outbox: { update: jest.fn() },
      };
      const svc = new OutboxService(prismaMock as any, undefined);
      const processed = await svc.dispatchPending();
      expect(processed).toBe(0);
    });

    it('marks row COMPLETED on dispatcher success', async () => {
      const r = row();
      const updateMock = jest.fn(async (_args: any) => r);
      const prismaMock = {
        $queryRaw: jest.fn(async () => [r]),
        outbox: { update: updateMock },
      };
      const dispatcher: OutboxDispatcher = {
        kind: OutboxKind.BET_WALLET_DEBIT,
        dispatch: jest.fn(async () => ({ ok: true })),
      };
      const svc = new OutboxService(prismaMock as any, [dispatcher]);
      const processed = await svc.dispatchPending();
      expect(processed).toBe(1);
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'row-1' },
          data: expect.objectContaining({ status: OutboxStatus.COMPLETED }),
        }),
      );
    });

    it('marks row DEAD on permanent failure', async () => {
      const r = row();
      const updateMock = jest.fn(async (_args: any) => r);
      const prismaMock = {
        $queryRaw: jest.fn(async () => [r]),
        outbox: { update: updateMock },
      };
      const dispatcher: OutboxDispatcher = {
        kind: OutboxKind.BET_WALLET_DEBIT,
        dispatch: jest.fn(async () => ({
          ok: false,
          permanent: true,
          error: 'insufficient_coins',
        })),
      };
      const svc = new OutboxService(prismaMock as any, [dispatcher]);
      await svc.dispatchPending();
      const calls = updateMock.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall.data.status).toBe(OutboxStatus.DEAD);
      expect(lastCall.data.lastError).toBe('insufficient_coins');
    });

    it('reschedules row PENDING on transient failure (not yet DEAD)', async () => {
      const r = row({ attempts: 2 });
      const updateMock = jest.fn(async (_args: any) => r);
      const prismaMock = {
        $queryRaw: jest.fn(async () => [r]),
        outbox: { update: updateMock },
      };
      const dispatcher: OutboxDispatcher = {
        kind: OutboxKind.BET_WALLET_DEBIT,
        dispatch: jest.fn(async () => ({
          ok: false,
          permanent: false,
          error: 'network',
        })),
      };
      const svc = new OutboxService(prismaMock as any, [dispatcher]);
      await svc.dispatchPending();
      const calls = updateMock.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall.data.status).toBe(OutboxStatus.PENDING);
      expect(lastCall.data.nextAttemptAt).toBeInstanceOf(Date);
    });

    it('marks row DEAD when the failing attempt was the final one', async () => {
      // attempt #7 already happened (claim incremented from 6→7),
      // next failure → DEAD.
      const r = row({ attempts: 7 });
      const updateMock = jest.fn(async (_args: any) => r);
      const prismaMock = {
        $queryRaw: jest.fn(async () => [r]),
        outbox: { update: updateMock },
      };
      const dispatcher: OutboxDispatcher = {
        kind: OutboxKind.BET_WALLET_DEBIT,
        dispatch: jest.fn(async () => ({ ok: false, permanent: false, error: 'still failing' })),
      };
      const svc = new OutboxService(prismaMock as any, [dispatcher]);
      await svc.dispatchPending();
      const calls = updateMock.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall.data.status).toBe(OutboxStatus.DEAD);
    });

    it('reschedules row when no dispatcher is registered for its kind', async () => {
      const r = row({ kind: OutboxKind.RAZORPAY_REFUND });
      const updateMock = jest.fn(async (_args: any) => r);
      const prismaMock = {
        $queryRaw: jest.fn(async () => [r]),
        outbox: { update: updateMock },
      };
      const dispatcher: OutboxDispatcher = {
        kind: OutboxKind.BET_WALLET_DEBIT,
        dispatch: jest.fn(),
      };
      const svc = new OutboxService(prismaMock as any, [dispatcher]);
      await svc.dispatchPending();
      // Should not have called the dispatcher.
      expect(dispatcher.dispatch).not.toHaveBeenCalled();
      // Should have rescheduled (treats unknown-kind as transient).
      const calls = updateMock.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall.data.status).toBe(OutboxStatus.PENDING);
      expect(lastCall.data.lastError).toContain('no dispatcher');
    });

    it('treats an uncaught dispatcher throw as transient retry', async () => {
      const r = row({ attempts: 1 });
      const updateMock = jest.fn(async (_args: any) => r);
      const prismaMock = {
        $queryRaw: jest.fn(async () => [r]),
        outbox: { update: updateMock },
      };
      const dispatcher: OutboxDispatcher = {
        kind: OutboxKind.BET_WALLET_DEBIT,
        dispatch: jest.fn(async () => {
          throw new Error('totally unexpected');
        }),
      };
      const svc = new OutboxService(prismaMock as any, [dispatcher]);
      await svc.dispatchPending();
      const calls = updateMock.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall.data.status).toBe(OutboxStatus.PENDING);
      expect(lastCall.data.lastError).toBe('totally unexpected');
    });
  });
});
