import type { Outbox, OutboxKind } from '@prisma/client';

/**
 * Per-kind side-effect dispatcher. Feature modules implement this
 * interface to expose their dispatch logic to the OutboxService.
 *
 * Registration: each dispatcher is added to the
 * `OUTBOX_DISPATCHER_REGISTRY` injection token via Nest's array
 * provider. See `outbox.module.ts` for the canonical wiring.
 *
 * Contract:
 *
 *   - `kind` is the OutboxKind this dispatcher handles. Exactly
 *     one dispatcher per kind across the whole app — duplicates
 *     are a startup bug (caught in OutboxModule's @OnModuleInit).
 *
 *   - `dispatch(row)` performs the side effect. Returns a
 *     `DispatchResult` describing what happened:
 *
 *       { ok: true }                         — mark COMPLETED
 *       { ok: false, permanent: true, … }    — mark DEAD on the
 *                                              first failure
 *       { ok: false, permanent: false, … }   — schedule a retry
 *
 *   - Dispatchers MUST be idempotent. The receiving service is
 *     allowed to see the same `idempotencyKey` twice (e.g. if
 *     this pod crashed between dispatching and updating the
 *     Outbox row). The receiver dedupes; the dispatcher should
 *     not.
 *
 *   - Dispatchers SHOULD NOT throw. They should catch their own
 *     errors and translate them into `permanent: true/false`.
 *     `OutboxService.dispatchPending()` catches uncaught throws
 *     and treats them as transient, but that's the slow path.
 */
export interface OutboxDispatcher {
  readonly kind: OutboxKind;
  dispatch(row: Outbox): Promise<DispatchResult>;
}

export interface DispatchResult {
  ok: boolean;
  /** When `ok` is false, distinguishes between transient (retry)
   *  and permanent (DEAD on first failure). Ignored when `ok` is
   *  true. */
  permanent?: boolean;
  /** Short, human-readable reason. Stored on `Outbox.lastError`. */
  error?: string;
  /** Optional structured detail for observability. Logged but not
   *  persisted onto the row. */
  detail?: Record<string, unknown>;
}

/** DI token for the dispatcher array. Imported from any module
 *  that wants to contribute a dispatcher:
 *
 *  ```ts
 *  {
 *    provide: OUTBOX_DISPATCHER_REGISTRY,
 *    useExisting: MyFeatureDispatcher,
 *    multi: true,
 *  }
 *  ```
 */
export const OUTBOX_DISPATCHER_REGISTRY = Symbol('OUTBOX_DISPATCHER_REGISTRY');
