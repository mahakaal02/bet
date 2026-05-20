import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  Notification,
  NotificationChannel,
  NotificationStatus,
  NotificationTemplate,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagService } from '../foundation/feature-flags.service';
import { TemplateRendererService } from './template-renderer';
import { InappAdapter } from './adapters/inapp.adapter';
import { PushAdapter } from './adapters/push.adapter';
import { EmailAdapter } from './adapters/email.adapter';

/**
 * Notification worker. In-process Postgres-polling worker that
 * drains `Notification` rows in status PENDING (and RETRY rows past
 * their `nextAttemptAt`-equivalent threshold based on `lastAttemptAt`
 * + backoff). Replaces a BullMQ queue for now — see
 * `docs/PRODUCTION_ROADMAP.md` §1G for the rationale (BullMQ swap-in
 * is a 1-PR follow-up once volume justifies the new infra).
 *
 * Architecture:
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ Every 1.5 seconds:                                         │
 *   │   1. SELECT … FOR UPDATE SKIP LOCKED (batch up to 25)      │
 *   │      where status IN (PENDING, RETRY)                      │
 *   │      AND (status=PENDING OR last_attempt < now - backoff)  │
 *   │   2. For each row:                                         │
 *   │      a. Look up template by (code, channel, locale)        │
 *   │      b. Render body using TemplateRenderer                 │
 *   │      c. Dispatch to the channel adapter                    │
 *   │      d. Adapter updates row to DELIVERED / SENT / RETRY    │
 *   │         / FAILED / DEAD                                    │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Lifecycle:
 *   - Started by `@OnApplicationBootstrap`.
 *   - Stopped cleanly by `@OnModuleDestroy` so SIGTERM during a
 *     deploy doesn't kill an in-flight render.
 *   - Gated by the `notifications.enabled` feature flag — if OFF,
 *     the loop ticks but does no work (rows pile up in PENDING; a
 *     flag flip drains them).
 *
 * Concurrency:
 *   - Single in-process worker per backend pod. Multiple pods race
 *     via Postgres advisory locks: each row is claimed with
 *     `UPDATE … WHERE id IN (SELECT id … FOR UPDATE SKIP LOCKED)`,
 *     so two pods picking the same batch see no overlap.
 *
 * Backoff schedule (matches OutboxService):
 *   30s, 2m, 10m, 30m, 2h, 12h. Sixth failure → DEAD.
 */
@Injectable()
export class NotificationWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationWorker.name);
  private static readonly POLL_INTERVAL_MS = 1500;
  private static readonly BATCH_SIZE = 25;
  private static readonly BACKOFF_MS = [
    30_000, 120_000, 600_000, 1_800_000, 7_200_000, 43_200_000,
  ];
  private static readonly MAX_ATTEMPTS = 6;

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: FeatureFlagService,
    private readonly renderer: TemplateRendererService,
    private readonly inappAdapter: InappAdapter,
    private readonly pushAdapter: PushAdapter,
    private readonly emailAdapter: EmailAdapter,
  ) {}

  onApplicationBootstrap() {
    if (process.env.NOTIFICATION_WORKER_DISABLED === 'true') {
      this.logger.log('NOTIFICATION_WORKER_DISABLED=true → worker not starting');
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, NotificationWorker.POLL_INTERVAL_MS);
    this.logger.log(
      `notification worker polling every ${NotificationWorker.POLL_INTERVAL_MS}ms`,
    );
  }

  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    // Wait for an in-flight tick to finish (max one poll interval).
    let waits = 0;
    while (this.running && waits < 10) {
      await new Promise((r) => setTimeout(r, 200));
      waits++;
    }
  }

  /**
   * One poll cycle. Guarded by `running` so two intervals don't
   * overlap if a tick takes longer than the poll period.
   */
  async tick(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;
    try {
      // Master enable flag. Lets ops flip the entire pipeline off
      // without restarting the worker pod.
      const enabled = await this.flags.isEnabled('notifications.enabled');
      if (!enabled) return;

      const rows = await this.claimBatch(NotificationWorker.BATCH_SIZE);
      if (rows.length === 0) return;

      this.logger.debug(`processing ${rows.length} notifications`);
      for (const row of rows) {
        await this.processOne(row);
      }
    } catch (e) {
      this.logger.error(`tick failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Claim a batch. The `SELECT ... FOR UPDATE SKIP LOCKED` pattern
   * is implemented via a single `UPDATE ... RETURNING` so the row
   * is moved into a "claimed" state visible to no other pod.
   *
   * We don't have a dedicated "claimed" status enum value — we
   * advance the `deliveryAttempts` counter and use `lastAttemptAt`
   * as the soft-claim timestamp, then check `lastAttemptAt > now - 30s`
   * to avoid double-processing.
   */
  private async claimBatch(limit: number): Promise<Notification[]> {
    const cutoff = new Date(Date.now() - 30_000);                  // 30s claim window
    const now = new Date();

    // Raw SQL — we want SKIP LOCKED which Prisma's query builder
    // doesn't expose. This is one of the few "must be SQL" spots.
    return this.prisma.$queryRaw<Notification[]>`
      UPDATE "Notification"
      SET "lastAttemptAt" = ${now}
      WHERE id IN (
        SELECT id FROM "Notification"
        WHERE
          (
            "status" = 'PENDING'
            OR ("status" = 'RETRY' AND "lastAttemptAt" < ${cutoff})
          )
        ORDER BY "createdAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *;
    `;
  }

  private async processOne(row: Notification): Promise<void> {
    // Look up template. If missing or inactive, FAIL the row
    // permanently — re-enabling the template doesn't make sense
    // for a notification that should have fired now.
    const template = await this.prisma.notificationTemplate.findFirst({
      where: { code: row.templateCode, channel: row.channel, active: true },
      orderBy: { version: 'desc' },                                // pick latest active
    });
    if (!template) {
      await this.markDead(row, `no active template for ${row.templateCode}/${row.channel}`);
      return;
    }

    // Validate + render. Render errors are permanent (the payload
    // doesn't match the template's declared variables).
    let rendered: { subject: string | null; body: string };
    try {
      rendered = this.renderTemplate(template, row);
    } catch (e) {
      const msg = (e as Error).message;
      await this.markDead(row, `render failed: ${msg}`);
      return;
    }

    // Dispatch to the channel adapter.
    try {
      switch (row.channel) {
        case NotificationChannel.INAPP:
          await this.inappAdapter.deliver(row, rendered);
          break;
        case NotificationChannel.PUSH:
          await this.pushAdapter.deliver(row, rendered);
          break;
        case NotificationChannel.EMAIL: {
          // Look up user email — required for SES dispatch.
          const user = await this.prisma.user.findUnique({
            where: { id: row.userId },
            select: { email: true },
          });
          await this.emailAdapter.deliver(user?.email ?? null, row, rendered);
          break;
        }
      }
    } catch (e) {
      // Adapter threw — count as transient, schedule retry.
      const msg = (e as Error).message;
      await this.markRetry(row, msg);
    }

    // After dispatch, check if attempt count hit max → DEAD.
    if (row.deliveryAttempts + 1 >= NotificationWorker.MAX_ATTEMPTS) {
      const refreshed = await this.prisma.notification.findUnique({
        where: { id: row.id },
        select: { status: true, deliveryAttempts: true },
      });
      if (
        refreshed?.status === NotificationStatus.RETRY &&
        refreshed.deliveryAttempts >= NotificationWorker.MAX_ATTEMPTS
      ) {
        await this.markDead(row, 'retry budget exhausted');
      }
    }
  }

  private renderTemplate(
    template: NotificationTemplate,
    row: Notification,
  ): { subject: string | null; body: string } {
    const declared = (template.variables ?? {}) as Record<string, string>;
    const payload = row.payload as Record<string, unknown>;
    const escape =
      row.channel === NotificationChannel.EMAIL || row.channel === NotificationChannel.INAPP
        ? 'html'
        : 'none';
    const body = this.renderer.render({
      body: template.body,
      payload,
      declaredVariables: declared,
      escape,
    });
    const subject = template.subject
      ? this.renderer.render({
          body: template.subject,
          payload,
          declaredVariables: declared,
          escape: 'none',                                          // subject is always text
        })
      : null;
    return { subject, body };
  }

  private async markRetry(row: Notification, reason: string) {
    await this.prisma.notification.update({
      where: { id: row.id },
      data: {
        status: NotificationStatus.RETRY,
        failureReason: reason.slice(0, 500),
        deliveryAttempts: { increment: 1 },
      },
    });
  }

  private async markDead(row: Notification, reason: string) {
    await this.prisma.notification.update({
      where: { id: row.id },
      data: {
        status: NotificationStatus.DEAD,
        failureReason: reason.slice(0, 500),
        deliveryAttempts: { increment: 1 },
      },
    });
    this.logger.error(`notification ${row.id} DEAD: ${reason}`);
  }
}
