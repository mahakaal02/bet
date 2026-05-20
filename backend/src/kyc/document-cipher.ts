import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { signRequest } from '../aws/sigv4';

/**
 * Document cipher — encrypts KYC payloads (PAN scans, selfies,
 * address proofs) before they hit the storage backend. Two layers
 * of defence:
 *
 *   1. **Application-layer envelope** (this file) — AES-256-GCM with
 *      a key Sourced from KMS. Stops a stolen S3 bucket from being
 *      sufficient to read user PII.
 *   2. **Bucket SSE-KMS** — provided by S3 itself when the storage
 *      driver is wired (see `S3KycStorage`). Stops a stolen AWS root
 *      key from being sufficient.
 *
 * Format on disk: same `v<n>.<iv>.<ct>.<tag>` envelope as
 * `SecretCipher` so admin recovery tooling can share parsing code.
 * The version prefix matches the `KycDocument.encryptionKeyVersion`
 * column so we can rotate keys without backfilling every row.
 *
 * Two implementations:
 *
 *   - `LocalKeyDocumentCipher` — key derived from
 *     `KYC_DOCUMENT_KEY` (or `JWT_SECRET` in dev). Same trust model
 *     as `SecretCipher`. Default in dev/CI.
 *   - `KmsDocumentCipher` — calls AWS KMS `Encrypt` / `Decrypt` for
 *     each operation. Stub until PR-INFRA-KMS-1 lands.
 */
export interface DocumentCipher {
  /** Returns ciphertext blob ready for storage + the key version it was
   * encrypted under (persisted in `KycDocument.encryptionKeyVersion`). */
  encrypt(plaintext: Buffer): Promise<{ ciphertext: Buffer; keyVersion: number }>;

  /** Reverse direction — `keyVersion` tells us which key to look up
   * (rotation-safe). Throws on tag mismatch (tampering detection). */
  decrypt(ciphertext: Buffer, keyVersion: number): Promise<Buffer>;
}

const HEADER_BYTES = 1 /* version */ + 12 /* iv */ + 16 /* tag */;

@Injectable()
export class LocalKeyDocumentCipher implements DocumentCipher {
  private readonly logger = new Logger(LocalKeyDocumentCipher.name);
  private readonly keyByVersion: Map<number, Buffer>;
  private readonly currentVersion: number;

  constructor(rawKey?: string, version = 1) {
    const k = rawKey ?? process.env.KYC_DOCUMENT_KEY ?? process.env.JWT_SECRET;
    if (!k || k.length < 16) {
      throw new Error(
        'LocalKeyDocumentCipher requires KYC_DOCUMENT_KEY (or JWT_SECRET in dev) of at least 16 chars.',
      );
    }
    this.currentVersion = version;
    this.keyByVersion = new Map([[version, crypto.createHash('sha256').update(k, 'utf8').digest()]]);
  }

  async encrypt(plaintext: Buffer): Promise<{ ciphertext: Buffer; keyVersion: number }> {
    const key = this.keyByVersion.get(this.currentVersion);
    if (!key) throw new Error(`No key for version ${this.currentVersion}`);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Layout: [version:1][iv:12][tag:16][ciphertext:N]
    const out = Buffer.alloc(HEADER_BYTES + ct.length);
    out.writeUInt8(this.currentVersion, 0);
    iv.copy(out, 1);
    tag.copy(out, 13);
    ct.copy(out, HEADER_BYTES);
    return { ciphertext: out, keyVersion: this.currentVersion };
  }

  async decrypt(blob: Buffer, keyVersion: number): Promise<Buffer> {
    if (blob.length < HEADER_BYTES) {
      throw new Error('KYC ciphertext truncated');
    }
    const versionByte = blob.readUInt8(0);
    if (versionByte !== keyVersion) {
      throw new Error(
        `KYC ciphertext version (${versionByte}) does not match column (${keyVersion}) — possible row corruption`,
      );
    }
    const key = this.keyByVersion.get(keyVersion);
    if (!key) throw new Error(`No key registered for version ${keyVersion}`);
    const iv = blob.subarray(1, 13);
    const tag = blob.subarray(13, 29);
    const ct = blob.subarray(HEADER_BYTES);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }
}

/**
 * AWS KMS document cipher (PR-INFRA-KMS-1) — envelope encryption.
 *
 * Why envelope and not direct KMS `Encrypt`/`Decrypt` per byte:
 *
 *   1. KMS `Encrypt` has a 4 KiB plaintext limit. Passport scans are
 *      easily 1–3 MB. We'd need to chunk + stitch, which is what the
 *      envelope pattern *is*, but uglier.
 *   2. KMS is a paid API (~$0.03 per 10k calls) and slow (~50ms per
 *      call). Envelope encryption uses KMS once per document for the
 *      data key, then does the bulk AES work locally — same security,
 *      ~100× cheaper at scale.
 *   3. AWS itself recommends this pattern for any payload > 4 KiB and
 *      uses it internally for S3 SSE-KMS. We get to verify our
 *      implementation against documented prior art.
 *
 * Wire pattern (per document):
 *
 *   encrypt:  KMS GenerateDataKey(alias/kalki/kyc, KeySpec=AES_256)
 *               → returns Plaintext (DEK) + CiphertextBlob (wrapped DEK)
 *             AES-256-GCM(plaintext, DEK, randomIv)
 *               → ciphertext + tag
 *             return [version=100][wrappedLen:2][wrapped][iv:12][tag:16][ciphertext]
 *
 *   decrypt:  parse envelope → KMS Decrypt(wrapped) → DEK
 *             AES-256-GCM-decrypt(ciphertext, DEK, iv, tag) → plaintext
 *
 * Why version byte = 100: the LocalKeyDocumentCipher reserves the
 * 1–99 range for local-key rotations. KMS envelopes start at 100 so
 * `KycDocument.encryptionKeyVersion` can tell at a glance which
 * cipher decrypted the row, without an extra column. If we ever
 * change the KMS envelope format, the next byte (101, 102…) tracks
 * the new layout — same backwards-compat strategy as the local
 * cipher.
 *
 * Why no `@aws-sdk/client-kms`: same reasoning as `S3KycStorage` and
 * the SES sender. KMS exposes a single REST endpoint with a JSON
 * body; SigV4 is shared via `aws/sigv4.ts`. The total marginal code
 * here is < 100 lines; the SDK would add ~6 MB.
 *
 * Env vars (set in Helm via `kalki-shared` secret):
 *   AWS_REGION            — e.g. ap-south-1
 *   AWS_ACCESS_KEY_ID     — IAM principal with kms:GenerateDataKey + kms:Decrypt
 *   AWS_SECRET_ACCESS_KEY — paired secret
 *   AWS_SESSION_TOKEN     — optional, for STS-assumed roles
 *   KYC_KMS_KEY_ID        — KMS alias / ARN, default: alias/kalki/kyc
 *
 * IAM: the backend's principal needs `kms:GenerateDataKey` and
 * `kms:Decrypt` on the key. NOT `kms:Encrypt` — envelope encryption
 * never directly encrypts payload bytes with the CMK.
 *
 * Activation: `KYC_CIPHER_DRIVER=kms` (wired in kyc.module.ts).
 */

/**
 * Envelope format version byte. Increment if the wire layout changes.
 * Used as `KycDocument.encryptionKeyVersion` so historical rows can
 * still be decrypted after a format bump.
 */
const KMS_ENVELOPE_V1 = 100;

/**
 * Bytes per envelope header field. `wrappedKey` is variable-length
 * (KMS-wrapped DEKs are ~184 bytes for AES_256 under a symmetric CMK
 * but it's not contractually fixed — the 2-byte length prefix lets
 * us tolerate future expansions without breaking older blobs).
 */
const KMS_VERSION_BYTES = 1;
const KMS_WRAPPED_LEN_BYTES = 2;
const KMS_IV_BYTES = 12;
const KMS_TAG_BYTES = 16;

/**
 * Minimum fetch typing so `globalThis.fetch` is acceptable in tests
 * + Node 18+ runtime without dragging in `@types/node-fetch`.
 */
type FetchImpl = (
  input: string,
  init?: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

@Injectable()
export class KmsDocumentCipher implements DocumentCipher {
  private readonly logger = new Logger(KmsDocumentCipher.name);
  private readonly region: string;
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly sessionToken: string | undefined;
  private readonly keyId: string;
  private readonly fetchImpl: FetchImpl;

  constructor(fetchImpl?: FetchImpl) {
    this.region = process.env.AWS_REGION ?? 'ap-south-1';
    this.accessKey = process.env.AWS_ACCESS_KEY_ID ?? '';
    this.secretKey = process.env.AWS_SECRET_ACCESS_KEY ?? '';
    this.sessionToken = process.env.AWS_SESSION_TOKEN || undefined;
    this.keyId = process.env.KYC_KMS_KEY_ID ?? 'alias/kalki/kyc';
    this.fetchImpl = fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
  }

  async encrypt(plaintext: Buffer): Promise<{ ciphertext: Buffer; keyVersion: number }> {
    this.assertCreds();

    // 1. Ask KMS for a fresh data-encryption key (DEK). KMS returns
    //    both the plaintext key bytes (used here in-memory) and the
    //    wrapped key (persisted in the envelope so we can recover the
    //    plaintext key later via Decrypt).
    const { plaintextKey, wrappedKey } = await this.generateDataKey();

    try {
      // 2. Local AES-256-GCM with a random IV. The 12-byte IV size
      //    is the GCM-recommended length; reusing IVs under the same
      //    key would leak plaintext, but each document gets its own
      //    fresh DEK so reuse is impossible.
      const iv = crypto.randomBytes(KMS_IV_BYTES);
      const cipher = crypto.createCipheriv('aes-256-gcm', plaintextKey, iv);
      const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();

      // 3. Assemble the envelope:
      //    [v:1][wrappedLen:2][wrapped:N][iv:12][tag:16][ciphertext:M]
      if (wrappedKey.length > 0xffff) {
        // 2-byte length cap; KMS-wrapped DEKs are ~200 bytes in
        // practice, but defend the invariant explicitly.
        throw new Error(`wrapped DEK too large (${wrappedKey.length} bytes)`);
      }
      const out = Buffer.alloc(
        KMS_VERSION_BYTES +
          KMS_WRAPPED_LEN_BYTES +
          wrappedKey.length +
          KMS_IV_BYTES +
          KMS_TAG_BYTES +
          ct.length,
      );
      let off = 0;
      out.writeUInt8(KMS_ENVELOPE_V1, off);
      off += KMS_VERSION_BYTES;
      out.writeUInt16BE(wrappedKey.length, off);
      off += KMS_WRAPPED_LEN_BYTES;
      wrappedKey.copy(out, off);
      off += wrappedKey.length;
      iv.copy(out, off);
      off += KMS_IV_BYTES;
      tag.copy(out, off);
      off += KMS_TAG_BYTES;
      ct.copy(out, off);

      return { ciphertext: out, keyVersion: KMS_ENVELOPE_V1 };
    } finally {
      // Best-effort: zero the plaintext DEK before it goes out of
      // scope. Node's GC may have already copied it; this is a
      // defence-in-depth gesture, not a guarantee.
      plaintextKey.fill(0);
    }
  }

  async decrypt(blob: Buffer, keyVersion: number): Promise<Buffer> {
    this.assertCreds();

    const minHeader =
      KMS_VERSION_BYTES + KMS_WRAPPED_LEN_BYTES + KMS_IV_BYTES + KMS_TAG_BYTES;
    if (blob.length < minHeader) {
      throw new Error('KMS ciphertext truncated');
    }
    const versionByte = blob.readUInt8(0);
    if (versionByte !== keyVersion) {
      throw new Error(
        `KMS ciphertext version (${versionByte}) does not match column (${keyVersion}) — possible row corruption`,
      );
    }
    if (versionByte !== KMS_ENVELOPE_V1) {
      throw new Error(`Unknown KMS envelope version ${versionByte}`);
    }

    let off = KMS_VERSION_BYTES;
    const wrappedLen = blob.readUInt16BE(off);
    off += KMS_WRAPPED_LEN_BYTES;
    if (blob.length < off + wrappedLen + KMS_IV_BYTES + KMS_TAG_BYTES) {
      throw new Error('KMS ciphertext truncated (wrapped-key length mismatch)');
    }
    const wrappedKey = blob.subarray(off, off + wrappedLen);
    off += wrappedLen;
    const iv = blob.subarray(off, off + KMS_IV_BYTES);
    off += KMS_IV_BYTES;
    const tag = blob.subarray(off, off + KMS_TAG_BYTES);
    off += KMS_TAG_BYTES;
    const ct = blob.subarray(off);

    // KMS Decrypt round-trip to recover the DEK.
    const plaintextKey = await this.kmsDecrypt(wrappedKey);
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', plaintextKey, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]);
    } finally {
      plaintextKey.fill(0);
    }
  }

  // ─── KMS API helpers ────────────────────────────────────────────

  /**
   * `GenerateDataKey` returns both the plaintext DEK and its wrapped
   * form. AES_256 is the only sensible spec for AES-256-GCM payload
   * encryption — we don't expose this knob to callers.
   */
  private async generateDataKey(): Promise<{ plaintextKey: Buffer; wrappedKey: Buffer }> {
    const body = JSON.stringify({ KeyId: this.keyId, KeySpec: 'AES_256' });
    const response = await this.kmsCall('TrentService.GenerateDataKey', body);
    const plaintextKey = Buffer.from(response.Plaintext ?? '', 'base64');
    const wrappedKey = Buffer.from(response.CiphertextBlob ?? '', 'base64');
    if (plaintextKey.length !== 32) {
      throw new Error(`KMS returned unexpected DEK length: ${plaintextKey.length}`);
    }
    if (wrappedKey.length === 0) {
      throw new Error('KMS returned empty CiphertextBlob');
    }
    return { plaintextKey, wrappedKey };
  }

  /**
   * `Decrypt` only needs the wrapped blob — KMS resolves the key
   * from metadata baked into it. That's how key rotation stays
   * transparent: a wrapped DEK from 6 months ago still decrypts
   * even after the CMK has been rotated, because KMS keeps every
   * historical version internally.
   */
  private async kmsDecrypt(wrappedKey: Buffer): Promise<Buffer> {
    const body = JSON.stringify({ CiphertextBlob: wrappedKey.toString('base64') });
    const response = await this.kmsCall('TrentService.Decrypt', body);
    const plaintext = Buffer.from(response.Plaintext ?? '', 'base64');
    if (plaintext.length !== 32) {
      throw new Error(`KMS Decrypt returned unexpected DEK length: ${plaintext.length}`);
    }
    return plaintext;
  }

  /**
   * One signed POST per call. KMS uses `application/x-amz-json-1.1`
   * + `X-Amz-Target: TrentService.<Op>` rather than path-based
   * routing — it's the same wire protocol as DynamoDB / STS / IAM.
   */
  private async kmsCall(
    target: 'TrentService.GenerateDataKey' | 'TrentService.Decrypt',
    body: string,
  ): Promise<{ Plaintext?: string; CiphertextBlob?: string; KeyId?: string }> {
    const url = `https://kms.${this.region}.amazonaws.com/`;
    const extraHeaders: Record<string, string> = {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': target,
    };
    const { headers } = signRequest({
      method: 'POST',
      url,
      service: 'kms',
      region: this.region,
      accessKey: this.accessKey,
      secretKey: this.secretKey,
      sessionToken: this.sessionToken,
      body,
      extraHeaders,
    });
    const res = await this.fetchImpl(url, { method: 'POST', headers, body });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`kms_call_failed target=${target} status=${res.status} body=${text.slice(0, 200)}`);
    }
    return (await res.json()) as { Plaintext?: string; CiphertextBlob?: string; KeyId?: string };
  }

  private assertCreds(): void {
    if (!this.accessKey || !this.secretKey) {
      // Loud failure rather than silent CLEAN — a misconfigured KMS
      // backend would otherwise let documents through unencrypted.
      throw new Error(
        'KmsDocumentCipher requires AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY env vars. ' +
          'Set them in the kalki-shared Secret or fall back to KYC_CIPHER_DRIVER=local.',
      );
    }
  }
}
