import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { FeatureFlagService } from './feature-flags.service';

/**
 * Outbox dispatch worker. In-process polling: every 500 ms wake up,
 * ask `OutboxService.dispatchPending()` for a batch, repeat.
 *
 * Adaptive cadence: when the previous tick processed ≥1 row we
 * stay at 500 ms. When the previous tick was empty we back off to
 * 2 s. This keeps Postgres load proportional to outbox traffic.
 *
 * Lifecycle:
 *   - Started by `@OnApplicationBootstrap` after Nest finishes
 *     wiring the dispatcher registry.
 *   - Stopped cleanly by `@OnModuleDestroy` so SIGTERM during a
 *     deploy doesn't kill an in-flight dispatch.
 *   - Gated by the `outbox.enabled` feature flag — when OFF, the
 *     loop ticks but does no work. Lets ops drain an existing
 *     backlog without restarting the pod.
 *
 * Concurrency:
 *   - One in-process worker per backend pod. Multiple pods race
 *     via Postgres SKIP LOCKED — see
 *     `OutboxService.claimBatch()`.
 *
 * Resilience:
 *   - A dispatcher that throws is treated as transient retry by
 *     `OutboxService.dispatchPending()`.
 *   - A worker pod that crashes mid-dispatch leaves the row in
 *     IN_FLIGHT — the 5-minute STUCK_AFTER_MS sweep reclaims it
 *     on the next claim batch.
 *
 * Disable via env var for local dev / migration windows:
 *   `OUTBOX_WORKER_DISABLED=true`.
 */
@Injectable()
export class OutboxWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  private static readonly POLL_INTERVAL_HOT_MS = 500;
  private static readonly POLL_INTERVAL_IDLE_MS = 2000;
  private static readonly BATCH_SIZE = 50;

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopping = false;
  private currentIntervalMs = OutboxWorker.POLL_INTERVAL_IDLE_MS;

  constructor(
    private readonly outbox: OutboxService,
    private readonly flags: FeatureFlagService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.OUTBOX_WORKER_DISABLED === 'true') {
      this.logger.log('OUTBOX_WORKER_DISABLED=true → worker not starting');
      return;
    }
    this.schedule();
    this.logger.log('outbox worker started');
  }

  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    // Wait briefly for an in-flight tick.
    let waited = 0;
    while (this.running && waited < 10) {
      await new Promise((r) => setTimeout(r, 200));
      waited++;
    }
  }

  private schedule() {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, this.currentIntervalMs);
  }

  /**
   * One poll cycle. Re-schedules the next tick at the adaptive
   * cadence. Guarded by `running` so two ticks can never overlap
   * (a slow batch can't get scheduled-on-top-of itself).
   */
  async tick(): Promise<void> {
    if (this.running || this.stopping) {
      this.schedule();
      return;
    }
    this.running = true;
    try {
      const enabled = await this.flags.isEnabled('outbox.enabled');
      if (!enabled) {
        this.currentIntervalMs = OutboxWorker.POLL_INTERVAL_IDLE_MS;
        return;
      }
      const processed = await this.outbox.dispatchPending(OutboxWorker.BATCH_SIZE);
      this.currentIntervalMs =
        processed > 0
          ? OutboxWorker.POLL_INTERVAL_HOT_MS
          : OutboxWorker.POLL_INTERVAL_IDLE_MS;
    } catch (e) {
      this.logger.error(`outbox tick failed: ${(e as Error).message}`);
      this.currentIntervalMs = OutboxWorker.POLL_INTERVAL_IDLE_MS;
    } finally {
      this.running = false;
      this.schedule();
    }
  }
}
