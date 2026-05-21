import { Injectable, Logger, Optional } from '@nestjs/common';
import { createVerify } from 'crypto';

/**
 * SNS signature verifier (PR-NOTIFY-3).
 *
 * SNS signs every payload it POSTs to subscribers. The signature
 * proves the payload originated from SNS and wasn't forged by an
 * attacker who scraped the public webhook URL. Without verification,
 * anyone who learns `https://api.kalki/webhooks/ses` can spray fake
 * bounce events to suppress arbitrary user emails.
 *
 * AWS SNS signing protocol:
 *
 *   1. SNS publishes a self-signed RSA cert at `SigningCertURL`. The
 *      URL is in the envelope itself, so we can't hard-code it — but
 *      we MUST validate it lives on an `*.amazonaws.com` host (else
 *      an attacker could point us at their cert).
 *   2. SNS builds a "string to sign" by concatenating a fixed-order
 *      set of envelope fields, then signs that with the cert's
 *      private key.
 *   3. We fetch the cert, RSA-verify the envelope's `Signature`
 *      against the reconstructed string-to-sign. SignatureVersion 1
 *      uses RSA-SHA1, version 2 uses RSA-SHA256.
 *
 * Reference: https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
 *
 * Why no `aws-sns-validator` dep: the validator is ~400 lines of
 * code that itself depends on `request` (deprecated) + `sax`. The
 * verification logic is ~80 lines of well-specified math against
 * Node's built-in `crypto`. Inlining it removes the supply-chain
 * risk on a security-critical path.
 *
 * Activation: set `NOTIFY_SNS_VERIFY=true` (env). Without that the
 * webhook keeps falling back to topic-ARN gating only — for dev,
 * CI, and during the rollout before SES is wired live.
 */

/**
 * The signed-envelope fields. `email-webhook.service.ts` only needed
 * a subset; this widens it to include the signing fields + the two
 * type-specific fields (`Subject` for Notification, `Token` for
 * SubscriptionConfirmation / UnsubscribeConfirmation).
 */
export interface SignedSnsEnvelope {
  Type: 'SubscriptionConfirmation' | 'Notification' | 'UnsubscribeConfirmation';
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  Signature: string;
  SignatureVersion: '1' | '2';
  SigningCertURL: string;
  /** Optional — `Notification` carries a Subject when set by the publisher. */
  Subject?: string;
  /** Required on SubscriptionConfirmation / UnsubscribeConfirmation. */
  Token?: string;
  /** Required on SubscriptionConfirmation. */
  SubscribeURL?: string;
}

export interface VerifyResult {
  valid: boolean;
  /** Populated when `valid=false`. Stable strings for metrics + log filtering. */
  reason?:
    | 'unsupported_signature_version'
    | 'invalid_signing_cert_url'
    | 'cert_fetch_failed'
    | 'signature_mismatch'
    | 'malformed_signature'
    | 'unsupported_envelope_type';
}

/**
 * Minimal fetch typing — `globalThis.fetch` is acceptable at
 * runtime (Node 18+) and tests inject a jest.fn.
 */
type FetchImpl = (
  input: string,
  init?: { method: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

@Injectable()
export class SnsSignatureVerifier {
  private readonly logger = new Logger(SnsSignatureVerifier.name);
  /**
   * Cert cache. The cert URLs are versioned by SNS — once fetched
   * the bytes are stable, so caching by URL is safe. We never
   * invalidate; SNS rotates certs by updating the URL not the
   * contents. Process restart re-warms the cache.
   *
   * Map (not LRU) because the working set is tiny — one cert per
   * SNS region per app, max ~10 entries ever.
   */
  private readonly certCache = new Map<string, string>();
  private readonly fetchImpl: FetchImpl;

  // `FetchImpl` is a function type — Nest emits `Function` as decorator
  // metadata and tries (and fails) to resolve it as a provider.
  // `@Optional()` lets the DI container pass `undefined`; we fall back
  // to `globalThis.fetch`. Mirrors EmailWebhookService / SesSender.
  constructor(@Optional() fetchImpl?: FetchImpl) {
    this.fetchImpl = fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
  }

  async verify(envelope: SignedSnsEnvelope): Promise<VerifyResult> {
    // 1. Reject unsupported signature versions.
    if (envelope.SignatureVersion !== '1' && envelope.SignatureVersion !== '2') {
      return { valid: false, reason: 'unsupported_signature_version' };
    }

    // 2. URL validation — defence against attacker-controlled certs.
    if (!isValidSigningCertUrl(envelope.SigningCertURL)) {
      return { valid: false, reason: 'invalid_signing_cert_url' };
    }

    // 3. Build the canonical string-to-sign before fetching the cert
    //    — if the envelope shape is unsupported we want to fail fast
    //    without touching the network.
    let stringToSign: string;
    try {
      stringToSign = buildStringToSign(envelope);
    } catch {
      return { valid: false, reason: 'unsupported_envelope_type' };
    }

    // 4. Fetch the cert (or hit cache).
    let certPem: string;
    try {
      certPem = await this.getCert(envelope.SigningCertURL);
    } catch (e) {
      this.logger.warn(`cert fetch failed: ${(e as Error).message}`);
      return { valid: false, reason: 'cert_fetch_failed' };
    }

    // 5. Decode the base64 signature.
    let signatureBytes: Buffer;
    try {
      signatureBytes = Buffer.from(envelope.Signature, 'base64');
    } catch {
      return { valid: false, reason: 'malformed_signature' };
    }
    if (signatureBytes.length === 0) {
      return { valid: false, reason: 'malformed_signature' };
    }

    // 6. RSA-verify. SignatureVersion 1 → SHA1, 2 → SHA256.
    //    Node's `createVerify` accepts PEM directly — no extra
    //    parsing step needed.
    const algo = envelope.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1';
    const verifier = createVerify(algo);
    verifier.update(stringToSign, 'utf8');
    const ok = verifier.verify(certPem, signatureBytes);
    return ok ? { valid: true } : { valid: false, reason: 'signature_mismatch' };
  }

  private async getCert(url: string): Promise<string> {
    const cached = this.certCache.get(url);
    if (cached) return cached;
    const res = await this.fetchImpl(url, { method: 'GET' });
    if (!res.ok) {
      throw new Error(`cert URL returned ${res.status}`);
    }
    const pem = await res.text();
    // Sanity-check the response looks like a PEM. Node's
    // `createVerify().verify()` accepts BOTH X.509 cert PEMs (what
    // real SNS returns) and bare public-key PEMs — both contain the
    // same RSA public key. We accept either so the test harness can
    // skip self-signing a full cert without losing coverage of the
    // RSA verification logic.
    if (!pem.includes('BEGIN CERTIFICATE') && !pem.includes('BEGIN PUBLIC KEY')) {
      throw new Error('cert body is not a PEM certificate or public key');
    }
    this.certCache.set(url, pem);
    return pem;
  }
}

// ─── helpers (exported for unit testing) ───────────────────────────

/**
 * Validate the signing cert URL is plausibly an SNS-controlled
 * endpoint. Per AWS docs the URL is always
 * `https://sns.<region>.amazonaws.com/<path>.pem`.
 *
 * We accept the lax `*.amazonaws.com` form rather than pinning to
 * `sns.*` because some AWS regions / partitions (e.g. GovCloud,
 * China) use different subdomain conventions. The HTTPS + `.pem`
 * checks are the load-bearing ones.
 */
export function isValidSigningCertUrl(raw: string): boolean {
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (!url.hostname.endsWith('.amazonaws.com')) return false;
  // Pathname check — defends against `?key=evil.pem`-style query
  // tricks since URL.pathname strips the query string.
  if (!url.pathname.endsWith('.pem')) return false;
  return true;
}

/**
 * Build the canonical string-to-sign per
 * https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
 *
 * Fields are concatenated in alphabetical order, each as
 * `<name>\n<value>\n`. The set of fields depends on the envelope
 * type:
 *
 *   Notification:  Message, MessageId, Subject (if present),
 *                  Timestamp, TopicArn, Type
 *   SubscriptionConfirmation / UnsubscribeConfirmation:
 *                  Message, MessageId, SubscribeURL, Timestamp,
 *                  Token, TopicArn, Type
 *
 * `Subject` is included ONLY when set (it's an optional field on the
 * publisher's side). Order matters — these are alphabetical, which
 * happens to be the canonical signing order.
 */
export function buildStringToSign(envelope: SignedSnsEnvelope): string {
  if (envelope.Type === 'Notification') {
    const fields: Array<[string, string]> = [
      ['Message', envelope.Message],
      ['MessageId', envelope.MessageId],
    ];
    if (envelope.Subject !== undefined) {
      fields.push(['Subject', envelope.Subject]);
    }
    fields.push(['Timestamp', envelope.Timestamp]);
    fields.push(['TopicArn', envelope.TopicArn]);
    fields.push(['Type', envelope.Type]);
    return fields.map(([k, v]) => `${k}\n${v}\n`).join('');
  }
  if (
    envelope.Type === 'SubscriptionConfirmation' ||
    envelope.Type === 'UnsubscribeConfirmation'
  ) {
    if (!envelope.Token || !envelope.SubscribeURL) {
      throw new Error('subscription envelope missing Token / SubscribeURL');
    }
    const fields: Array<[string, string]> = [
      ['Message', envelope.Message],
      ['MessageId', envelope.MessageId],
      ['SubscribeURL', envelope.SubscribeURL],
      ['Timestamp', envelope.Timestamp],
      ['Token', envelope.Token],
      ['TopicArn', envelope.TopicArn],
      ['Type', envelope.Type],
    ];
    return fields.map(([k, v]) => `${k}\n${v}\n`).join('');
  }
  throw new Error(`unsupported envelope type: ${(envelope as { Type: string }).Type}`);
}
