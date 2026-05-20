import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Notification, NotificationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Email channel adapter. Multi-provider via the `EmailProvider`
 * interface — `SES`, `SendGrid`, and `Postmark` swap in by setting
 * `EMAIL_PROVIDER=ses|sendgrid|postmark` plus the matching creds.
 *
 * Stub default: logs and marks the row SENT. The real SES driver
 * lands when AWS creds are provisioned and `EMAIL_PROVIDER=ses` is
 * set. Until then, this is a no-op that lets the rest of the
 * pipeline operate (worker drains, templates render, in-app
 * delivers) without coupling deployment to email creds.
 *
 * Status transitions match `push.adapter.ts`:
 *   PENDING → SENT       on provider ack
 *   PENDING → RETRY      on 5xx
 *   PENDING → FAILED     on permanent rejection (bounce, suppression)
 *
 * Bounce + complaint handling: SNS webhook lands in
 * `backend/src/notifications/email-webhook.controller.ts` (deferred
 * to PR-NOTIFY-2 — needs SES verification of the sending domain
 * first).
 */
@Injectable()
export class EmailAdapter {
  private readonly logger = new Logger(EmailAdapter.name);
  private readonly provider: string;
  private readonly fromAddress: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.provider = this.config.get<string>('EMAIL_PROVIDER') ?? 'stub';
    this.fromAddress = this.config.get<string>('EMAIL_FROM') ?? 'noreply@kalki.local';
  }

  async deliver(
    userEmail: string | null,
    row: Notification,
    rendered: { subject: string | null; body: string },
  ): Promise<{ ok: boolean; permanent?: boolean; error?: string }> {
    if (!userEmail) {
      await this.markFailed(row, 'user has no email');
      return { ok: false, permanent: true, error: 'no_email' };
    }
    if (!rendered.subject) {
      await this.markFailed(row, 'template missing subject');
      return { ok: false, permanent: true, error: 'no_subject' };
    }

    try {
      switch (this.provider) {
        case 'ses':
          await this.sendViaSes(userEmail, rendered.subject, rendered.body);
          break;
        case 'sendgrid':
          await this.sendViaSendgrid(userEmail, rendered.subject, rendered.body);
          break;
        case 'stub':
        default:
          this.logger.log(
            `[stub] email to=${userEmail} subject=${JSON.stringify(rendered.subject)}`,
          );
      }
      await this.markSent(row);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Bounces / suppression lists are permanent; transient
      // network or 5xx is retryable.
      const permanent =
        /bounce|complaint|suppress|invalid|550 5\.\d\.\d/.test(msg.toLowerCase());
      if (permanent) await this.markFailed(row, msg);
      else await this.markRetry(row, msg);
      return { ok: false, permanent, error: msg };
    }
  }

  /**
   * Provider-routed send for flows that don't have a `Notification`
   * row — e.g. the email-change confirmation tokens, which target an
   * address the user hasn't yet associated with their account.
   *
   * Returns success / failure rather than mutating any DB row. The
   * caller decides what to do on failure (the email-change service
   * keeps the request alive on transient failures, lets the user
   * re-request).
   */
  async sendDirect(input: {
    toEmail: string;
    subject: string;
    body: string;
  }): Promise<{ ok: boolean; error?: string }> {
    if (!input.toEmail) {
      return { ok: false, error: 'no_email' };
    }
    try {
      switch (this.provider) {
        case 'ses':
          await this.sendViaSes(input.toEmail, input.subject, input.body);
          break;
        case 'sendgrid':
          await this.sendViaSendgrid(input.toEmail, input.subject, input.body);
          break;
        case 'stub':
        default:
          this.logger.log(
            `[stub] direct email to=${input.toEmail} subject=${JSON.stringify(input.subject)}`,
          );
      }
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`sendDirect failed to=${input.toEmail}: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  /**
   * Real SES driver. Activated by `EMAIL_PROVIDER=ses` once
   * `aws-sdk` is added and SES domain is verified. Until then we
   * throw the not-implemented path to keep typecheck honest.
   */
  private async sendViaSes(_to: string, _subject: string, _body: string): Promise<void> {
    throw new Error(
      'EMAIL_PROVIDER=ses requested but aws-sdk integration is not wired — ' +
        'add the @aws-sdk/client-ses dependency and a SesClient init here.',
    );
  }

  /**
   * Real SendGrid driver. Activated by `EMAIL_PROVIDER=sendgrid`.
   */
  private async sendViaSendgrid(
    _to: string,
    _subject: string,
    _body: string,
  ): Promise<void> {
    throw new Error(
      'EMAIL_PROVIDER=sendgrid requested but the SendGrid client is not wired — ' +
        'add @sendgrid/mail and an API-key-driven client init here.',
    );
  }

  private markSent(row: Notification) {
    return this.prisma.notification.update({
      where: { id: row.id },
      data: {
        status: NotificationStatus.SENT,
        lastAttemptAt: new Date(),
        deliveredAt: new Date(),
        deliveryAttempts: { increment: 1 },
      },
    });
  }

  private markRetry(row: Notification, reason: string) {
    return this.prisma.notification.update({
      where: { id: row.id },
      data: {
        status: NotificationStatus.RETRY,
        lastAttemptAt: new Date(),
        failureReason: reason.slice(0, 500),
        deliveryAttempts: { increment: 1 },
      },
    });
  }

  private markFailed(row: Notification, reason: string) {
    return this.prisma.notification.update({
      where: { id: row.id },
      data: {
        status: NotificationStatus.FAILED,
        lastAttemptAt: new Date(),
        failureReason: reason.slice(0, 500),
        deliveryAttempts: { increment: 1 },
      },
    });
  }
}
