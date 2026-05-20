import { Body, Controller, Headers, HttpCode, Logger, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { EmailWebhookService, SnsEnvelope } from './email-webhook.service';
import {
  SnsSignatureVerifier,
  SignedSnsEnvelope,
} from './sns-signature-verifier';

/**
 * SNS → Kalki webhook endpoint for SES bounce / complaint events.
 *
 *   POST /webhooks/ses
 *
 * The endpoint is intentionally PUBLIC (no JWT) — SNS doesn't carry
 * one. Three defences in lieu of auth:
 *
 *   1. Topic ARN check — the env var `NOTIFY_WEBHOOK_TOPIC_ARN` must
 *      match the envelope's `TopicArn`. Wrong topic ⇒ 200 ignored.
 *   2. Signature verification (PR-NOTIFY-3) — RSA-verify the
 *      envelope's `Signature` against the published SNS cert. Gated
 *      on `NOTIFY_SNS_VERIFY=true` so dev/CI can still POST mock
 *      payloads without certs. In prod this MUST be on; without it
 *      anyone who learns the webhook URL can suppress arbitrary
 *      user emails by POST-ing fake bounce events.
 *   3. Throttling — 60 req/min/IP via the global default. SNS
 *      retries on 5xx but not 4xx, so we 200 on every well-formed
 *      payload (verification failures included) to avoid a retry
 *      storm during a brief DB outage.
 */
@Controller('webhooks/ses')
export class EmailWebhookController {
  private readonly logger = new Logger(EmailWebhookController.name);
  private readonly expectedTopicArn: string;
  private readonly verifyEnabled: boolean;

  constructor(
    private readonly webhookSvc: EmailWebhookService,
    private readonly verifier: SnsSignatureVerifier,
    config: ConfigService,
  ) {
    this.expectedTopicArn = config.get<string>('NOTIFY_WEBHOOK_TOPIC_ARN') ?? '';
    // String truthy check — `NOTIFY_SNS_VERIFY=true` (canonical),
    // `true`/`1`/`yes` (lenient) all enable verification. Anything
    // else (including absent) leaves it OFF for backwards compat.
    const raw = (config.get<string>('NOTIFY_SNS_VERIFY') ?? '').toLowerCase();
    this.verifyEnabled = raw === 'true' || raw === '1' || raw === 'yes';
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

    // Signature gate. We 200 + 'invalid_signature' rather than 4xx
    // so a determined attacker can't distinguish "I forged it badly"
    // from "you weren't a subscriber" — same response shape either
    // way. The Action is logged for the operator to spot abuse.
    if (this.verifyEnabled) {
      const verifyResult = await this.verifier.verify(body as SignedSnsEnvelope);
      if (!verifyResult.valid) {
        this.logger.warn(
          `SNS signature verification failed (${verifyResult.reason}) — topic=${body?.TopicArn} msgId=${body?.MessageId}`,
        );
        return { ok: true, action: `invalid_signature:${verifyResult.reason}` };
      }
    }

    const res = await this.webhookSvc.handle(body);
    return { ok: true, action: res.action };
  }
}
