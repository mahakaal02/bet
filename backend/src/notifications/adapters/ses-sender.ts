import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Minimal SES sender (PR-NOTIFY-2). We deliberately don't pull
 * `@aws-sdk/client-ses` into the build until the infra team
 * provisions the IAM role + verified domain — but we DO want the
 * full sending logic in place so the swap is one config flip away,
 * not a code change.
 *
 * Strategy: SES's `SendEmail` action speaks plain HTTPS + SigV4. We
 * use Node's `fetch` (Node 18+) and a tiny SigV4 implementation. No
 * dependency added to `package.json` — the deploy that flips
 * `EMAIL_PROVIDER=ses` just needs `AWS_ACCESS_KEY_ID`,
 * `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `EMAIL_FROM` env vars set.
 *
 * For unit tests we inject a `fetchImpl` so the test can assert the
 * request shape (headers, body) without actually hitting AWS. Real
 * boot uses global `fetch`.
 */

export interface SesSendInput {
  to: string;
  subject: string;
  body: string;
}

export type FetchImpl = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

@Injectable()
export class SesSender {
  private readonly logger = new Logger(SesSender.name);
  private readonly region: string;
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly fromAddress: string;
  private readonly fetchImpl: FetchImpl;

  constructor(
    config: ConfigService,
    // `FetchImpl` is a TypeScript function-type alias — at runtime
    // TS emits the decorator metadata as the bare `Function`
    // constructor, which Nest then tries (and fails) to resolve as
    // a provider. `@Optional()` tells the DI container to pass
    // `undefined` when no provider is registered — preserving the
    // test-time injection seam without breaking prod bootstrap.
    @Optional() fetchImpl?: FetchImpl,
  ) {
    this.region = config.get<string>('AWS_REGION') ?? 'ap-south-1';
    this.accessKey = config.get<string>('AWS_ACCESS_KEY_ID') ?? '';
    this.secretKey = config.get<string>('AWS_SECRET_ACCESS_KEY') ?? '';
    this.fromAddress = config.get<string>('EMAIL_FROM') ?? 'noreply@kalki.local';
    this.fetchImpl = fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
  }

  /**
   * Send via SES `/v2/email/outbound-emails` (the modern JSON API).
   * Throws on non-2xx — caller decides retry vs fail. The error
   * message preserves any SES error code in the body so the
   * EmailAdapter can classify it (e.g. `MessageRejected` =
   * permanent, `Throttling` = retryable).
   */
  async send(input: SesSendInput): Promise<{ messageId: string }> {
    if (!this.accessKey || !this.secretKey) {
      throw new Error('ses_creds_missing');
    }
    const endpoint = `https://email.${this.region}.amazonaws.com/v2/email/outbound-emails`;
    const payload = {
      FromEmailAddress: this.fromAddress,
      Destination: { ToAddresses: [input.to] },
      Content: {
        Simple: {
          Subject: { Data: input.subject, Charset: 'UTF-8' },
          Body: { Text: { Data: input.body, Charset: 'UTF-8' } },
        },
      },
    };
    const body = JSON.stringify(payload);
    const headers = await this.sign(endpoint, body);
    const res = await this.fetchImpl(endpoint, { method: 'POST', headers, body });
    if (!res.ok) {
      const text = await res.text();
      // Classify permanent vs transient up front; the EmailAdapter
      // regex still picks this up but throwing a structured message
      // makes future log-grepping easier.
      throw new Error(`ses_send_failed status=${res.status} body=${text.slice(0, 200)}`);
    }
    const text = await res.text();
    // Real SES returns { MessageId: "<id>" }. Be defensive — a
    // gateway may proxy + change shape.
    try {
      const parsed = JSON.parse(text) as { MessageId?: string };
      return { messageId: parsed.MessageId ?? '' };
    } catch {
      return { messageId: '' };
    }
  }

  /**
   * SigV4 signing — minimal implementation sufficient for SES.
   * Kept inline rather than pulled from a library so the
   * dependency surface stays at zero.
   *
   * Algorithm:
   *   1. Canonical request hash
   *   2. String-to-sign with the credential scope
   *   3. HMAC-SHA256 chain to derive the signing key
   *   4. Authorization header with the final signature
   *
   * Out of scope for this stub: query-string signing, STS session
   * tokens (X-Amz-Security-Token), URL-encoded path special cases.
   * The SES email endpoint doesn't need any of those.
   */
  private async sign(endpoint: string, body: string): Promise<Record<string, string>> {
    const url = new URL(endpoint);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const service = 'ses';
    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${this.region}/${service}/aws4_request`;

    // 1) Canonical request.
    const { createHash, createHmac } = await import('crypto');
    const payloadHash = createHash('sha256').update(body).digest('hex');
    const canonicalHeaders =
      `content-type:application/json\n` +
      `host:${url.host}\n` +
      `x-amz-date:${amzDate}\n`;
    const signedHeaders = 'content-type;host;x-amz-date';
    const canonicalRequest =
      `POST\n${url.pathname}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    // 2) String to sign.
    const stringToSign =
      `${algorithm}\n${amzDate}\n${credentialScope}\n` +
      createHash('sha256').update(canonicalRequest).digest('hex');

    // 3) Derive signing key.
    const kDate = createHmac('sha256', `AWS4${this.secretKey}`).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(this.region).digest();
    const kService = createHmac('sha256', kRegion).update(service).digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    // 4) Authorization header.
    return {
      'content-type': 'application/json',
      host: url.host,
      'x-amz-date': amzDate,
      Authorization:
        `${algorithm} Credential=${this.accessKey}/${credentialScope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }
}
