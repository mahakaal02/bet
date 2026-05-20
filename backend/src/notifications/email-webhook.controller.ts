import { Body, Controller, Headers, HttpCode, Logger, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { EmailWebhookService, SnsEnvelope } from './email-webhook.service';

/**
 * SNS → Kalki webhook endpoint for SES bounce / complaint events.
 *
 *   POST /webhooks/ses
 *
 * The endpoint is intentionally PUBLIC (no JWT) — SNS doesn't carry
 * one. Two defences in lieu of auth:
 *
 *   1. Topic ARN check — the env var `NOTIFY_WEBHOOK_TOPIC_ARN` must
 *      match the envelope's `TopicArn`. Wrong topic ⇒ 200 ignored.
 *   2. Signature verification (TODO PR-NOTIFY-3) — load the SNS
 *      signing cert + verify the envelope `Signature`. Until that
 *      lands, the endpoint trusts the topic-ARN check.
 *
 * Throttled at 60 req/min/IP via the global default. SNS retries on
 * 5xx but not 4xx — we 200 on every well-formed payload so SNS
 * doesn't bomb us with retries during a brief DB outage.
 */
@Controller('webhooks/ses')
export class EmailWebhookController {
  private readonly logger = new Logger(EmailWebhookController.name);
  private readonly expectedTopicArn: string;

  constructor(
    private readonly webhookSvc: EmailWebhookService,
    config: ConfigService,
  ) {
    this.expectedTopicArn = config.get<string>('NOTIFY_WEBHOOK_TOPIC_ARN') ?? '';
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(200)
  @Post()
  async receive(
    @Body() body: SnsEnvelope,
    @Headers('x-amz-sns-message-type') messageType?: string,
  ): Promise<{ ok: true; action: string }> {
    // SNS sets the type both in the body AND in this header.
    // Trust the body but log header mismatches.
    if (messageType && messageType !== body?.Type) {
      this.logger.warn(`SNS type header (${messageType}) mismatches body.Type (${body?.Type})`);
    }

    if (this.expectedTopicArn && body?.TopicArn !== this.expectedTopicArn) {
      this.logger.warn(`SNS topic ARN mismatch: got ${body?.TopicArn}`);
      return { ok: true, action: 'topic_mismatch' };
    }

    const res = await this.webhookSvc.handle(body);
    return { ok: true, action: res.action };
  }
}
