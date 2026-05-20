import { Injectable, Logger } from '@nestjs/common';
import {
  Notification,
  NotificationChannel,
  NotificationStatus,
} from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Public notification enqueue API. The single entry point that every
 * notification-generating business event (outbid, order shipped,
 * daily streak, password reset, etc.) calls into.
 *
 * Contract:
 *
 *   notifications.enqueue({
 *     templateCode: 'auction_outbid_v1',
 *     userId: 'user-123',
 *     channels: ['PUSH', 'INAPP'],     // optional — defaults from preferences
 *     payload: { auctionTitle: '…', myBid: 9.42, newLeaderBid: 9.41 },
 *     // The CALLER provides an idempotency anchor unique to this
 *     // event-instance — re-enqueueing the same anchor is a no-op.
 *     idempotencyAnchor: `auction:${auctionId}:outbid:${userId}:${roundCount}`,
 *   })
 *
 * Internally this:
 *   1. Reads NotificationPreference for the user — drops channels the
 *      user has opted out of (except `responsibleGambling` which is
 *      regulatory and can't be disabled).
 *   2. Hashes `(userId, templateCode, idempotencyAnchor)` into the
 *      Notification.idempotencyKey unique column. Duplicate enqueue
 *      attempts on the same anchor are silent no-ops.
 *   3. Writes one Notification row per surviving channel, status
 *      PENDING. The BullMQ notification worker (PR-NOTIFY-1) picks
 *      these up, renders the template, dispatches per channel.
 *   4. Optionally writes an Outbox row of kind FCM_PUSH / SES_EMAIL
 *      for the worker to drain. The Foundation PR ships the contract;
 *      the BullMQ wiring lands in PR-NOTIFY-1.
 *
 * No external calls happen in this function — all dispatch is
 * deferred to the worker so this stays safe to call inside an
 * existing Prisma transaction.
 *
 * Skeleton — Foundation PR ships the contract + the PENDING row
 * write. Worker dispatch lives in `notification.worker.ts` (also in
 * this PR as a stub) and is enabled by the `notifications.enabled`
 * FeatureFlag.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async enqueue(input: {
    templateCode: string;
    userId: string;
    payload: Record<string, unknown>;
    idempotencyAnchor: string;
    /** Override channel selection. If omitted, defaults to all
     *  channels enabled by the user's NotificationPreference. */
    channels?: NotificationChannel[];
    /** For attribution + analytics — campaign-driven notifications
     *  carry the campaign id so opens/clicks aggregate correctly. */
    campaignId?: string;
  }): Promise<Notification[]> {
    const prefs = await this.prisma.notificationPreference.findUnique({
      where: { userId: input.userId },
    });

    const requested = input.channels ?? [
      NotificationChannel.PUSH,
      NotificationChannel.EMAIL,
      NotificationChannel.INAPP,
    ];
    const filtered = requested.filter((ch) => this.isChannelEnabled(ch, prefs, input.templateCode));
    if (filtered.length === 0) {
      this.logger.debug(
        `enqueue: all channels disabled for ${input.userId} (${input.templateCode})`,
      );
      return [];
    }

    const rows: Notification[] = [];
    for (const channel of filtered) {
      const idempotencyKey = NotificationService.computeKey(
        input.userId,
        input.templateCode,
        channel,
        input.idempotencyAnchor,
      );
      // `upsert` keeps the original row on idempotent retries —
      // returning the existing one is correct semantics here.
      const row = await this.prisma.notification.upsert({
        where: { idempotencyKey },
        update: {},                              // no-op on duplicate
        create: {
          userId: input.userId,
          templateCode: input.templateCode,
          channel,
          status: NotificationStatus.PENDING,
          payload: input.payload as object,
          idempotencyKey,
          campaignId: input.campaignId,
        },
      });
      rows.push(row);
    }
    return rows;
  }

  private isChannelEnabled(
    channel: NotificationChannel,
    prefs:
      | {
          outbid: boolean;
          auctionEnding: boolean;
          orderUpdates: boolean;
          dailyStreak: boolean;
          marketingPush: boolean;
          marketingEmail: boolean;
          responsibleGambling: boolean;
        }
      | null,
    templateCode: string,
  ): boolean {
    // No preferences yet → defaults are all-on for transactional,
    // off for marketing (matches the NotificationPreference defaults).
    if (!prefs) return !templateCode.startsWith('marketing_');

    // Regulatory: responsible-gambling notifications always send.
    if (templateCode.startsWith('rg_')) return true;

    // Template-specific overrides.
    if (templateCode.startsWith('marketing_')) {
      if (channel === NotificationChannel.PUSH) return prefs.marketingPush;
      if (channel === NotificationChannel.EMAIL) return prefs.marketingEmail;
      return false;                              // no in-app marketing yet
    }
    if (templateCode === 'auction_outbid_v1') return prefs.outbid;
    if (templateCode.startsWith('auction_ending')) return prefs.auctionEnding;
    if (templateCode.startsWith('order_')) return prefs.orderUpdates;
    if (templateCode.startsWith('daily_streak_')) return prefs.dailyStreak;

    // Default: send (transactional / account events).
    return true;
  }

  /**
   * Stable per-(user, template, channel, anchor) key. The anchor is
   * supplied by the caller — anything that makes the event unique
   * (auctionId + outbid-round-number, withdrawalId, etc.) keeps
   * retries idempotent.
   */
  private static computeKey(
    userId: string,
    templateCode: string,
    channel: NotificationChannel,
    anchor: string,
  ): string {
    return crypto
      .createHash('sha1')
      .update(`${userId}|${templateCode}|${channel}|${anchor}`)
      .digest('hex');
  }
}
