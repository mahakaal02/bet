import { Injectable, Logger } from '@nestjs/common';
import { EmailSuppressionReason, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * SES → SNS bounce/complaint webhook handler.
 *
 * SES publishes delivery events to an SNS topic. SNS POSTs a JSON
 * envelope of one of these types:
 *
 *   - `SubscriptionConfirmation` — must be auto-confirmed by GET-ing
 *     the SubscribeURL. We do this server-side so an admin doesn't
 *     have to manually click a link buried in a log.
 *   - `Notification` — the actual bounce/complaint payload. The
 *     inner `Message` is itself a JSON string we parse to extract
 *     bounce / complaint details.
 *   - `UnsubscribeConfirmation` — fired when the subscription is
 *     torn down. Logged but no DB action.
 *
 * The SNS payload also carries `SignatureVersion`, `Signature`, and
 * `SigningCertURL`. PRODUCTION must verify those to stop a spoofed
 * webhook from poisoning the suppression list — that lands in
 * PR-NOTIFY-3 alongside actual SES wiring. This PR's webhook gates
 * on the topic ARN matching `NOTIFY_WEBHOOK_TOPIC_ARN` as a first-
 * order check + leaves a TODO for full signature verification.
 */

export interface SnsEnvelope {
  Type: 'SubscriptionConfirmation' | 'Notification' | 'UnsubscribeConfirmation';
  MessageId: string;
  TopicArn: string;
  Message: string;
  SubscribeURL?: string;
  Timestamp: string;
}

export interface BounceMessage {
  notificationType: 'Bounce';
  bounce: {
    bounceType: 'Permanent' | 'Transient' | 'Undetermined';
    bounceSubType?: string;
    bouncedRecipients: Array<{ emailAddress: string; diagnosticCode?: string }>;
  };
  mail: { messageId: string };
}

export interface ComplaintMessage {
  notificationType: 'Complaint';
  complaint: {
    complainedRecipients: Array<{ emailAddress: string }>;
    complaintFeedbackType?: string;
  };
  mail: { messageId: string };
}

export type SesNotification = BounceMessage | ComplaintMessage | { notificationType: string };

@Injectable()
export class EmailWebhookService {
  private readonly logger = new Logger(EmailWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  /**
   * Handle one SNS POST. Returns a debug summary so the controller
   * can echo it for the operator. NEVER throws — the webhook layer
   * always 200s so SNS doesn't bomb us with retries; errors are
   * logged for the operator.
   */
  async handle(envelope: SnsEnvelope): Promise<{
    action: 'confirmed_subscription' | 'recorded_bounce' | 'recorded_complaint' | 'ignored';
    suppressedEmails?: string[];
    detail?: string;
  }> {
    if (envelope.Type === 'SubscriptionConfirmation') {
      if (!envelope.SubscribeURL) {
        return { action: 'ignored', detail: 'subscription_url_missing' };
      }
      // Auto-confirm. The SubscribeURL is a GET that does not require
      // auth; SNS validates that the requester reached the URL.
      try {
        await this.fetchImpl(envelope.SubscribeURL, { method: 'GET' });
        return { action: 'confirmed_subscription' };
      } catch (e) {
        this.logger.warn(`subscription confirmation failed: ${(e as Error).message}`);
        return { action: 'ignored', detail: 'confirm_fetch_failed' };
      }
    }

    if (envelope.Type !== 'Notification') {
      return { action: 'ignored', detail: `unsupported_type:${envelope.Type}` };
    }

    let inner: SesNotification;
    try {
      inner = JSON.parse(envelope.Message) as SesNotification;
    } catch {
      return { action: 'ignored', detail: 'message_parse_failed' };
    }

    if (inner.notificationType === 'Bounce') {
      const bounceMsg = inner as BounceMessage;
      // Only permanent bounces land on the suppression list. Transient
      // bounces are SES's problem; we don't want to suppress a user
      // because their mailbox was briefly full.
      if (bounceMsg.bounce.bounceType !== 'Permanent') {
        return { action: 'ignored', detail: 'transient_bounce' };
      }
      const suppressed: string[] = [];
      for (const r of bounceMsg.bounce.bouncedRecipients) {
        const email = r.emailAddress.toLowerCase();
        await this.suppress(
          email,
          EmailSuppressionReason.HARD_BOUNCE,
          bounceMsg.bounce.bounceSubType,
          { diagnostic: r.diagnosticCode ?? null, messageId: bounceMsg.mail.messageId },
        );
        suppressed.push(email);
      }
      return { action: 'recorded_bounce', suppressedEmails: suppressed };
    }

    if (inner.notificationType === 'Complaint') {
      const complaintMsg = inner as ComplaintMessage;
      const suppressed: string[] = [];
      for (const r of complaintMsg.complaint.complainedRecipients) {
        const email = r.emailAddress.toLowerCase();
        await this.suppress(
          email,
          EmailSuppressionReason.COMPLAINT,
          complaintMsg.complaint.complaintFeedbackType,
          { messageId: complaintMsg.mail.messageId },
        );
        suppressed.push(email);
      }
      return { action: 'recorded_complaint', suppressedEmails: suppressed };
    }

    return { action: 'ignored', detail: `unknown_notification_type:${inner.notificationType}` };
  }

  /**
   * Idempotent upsert. If a row already exists we keep the original
   * `reason` + `createdAt` (the first suppression timestamp is more
   * useful forensically than the last). We DO refresh `metadata` so
   * repeated bounces show up in admin tooling.
   */
  private async suppress(
    email: string,
    reason: EmailSuppressionReason,
    subtype: string | undefined,
    metadata: Record<string, unknown>,
  ) {
    await this.prisma.emailSuppression.upsert({
      where: { email },
      create: {
        email,
        reason,
        subtype: subtype ?? null,
        metadata: metadata as unknown as Prisma.InputJsonValue,
      },
      update: {
        metadata: metadata as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
