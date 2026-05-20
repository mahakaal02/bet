import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { signRequest } from '../aws/sigv4';

/**
 * KYC document storage abstraction.
 *
 * Two reasons this is an interface, not a direct S3 SDK call:
 *
 *   1. Local dev — running the full S3+KMS+ClamAV chain in CI on every
 *      PR is overkill. The disk-backed stub keeps the upload path
 *      exercisable in tests without LocalStack, and `npm run start:dev`
 *      works without AWS creds.
 *   2. Cipher independence — encryption happens before bytes reach the
 *      bucket (see `DocumentCipher`). Storage just persists the
 *      ciphertext blob and hands back a key. Whether that key resolves
 *      to S3, Backblaze, or `/var/kyc` is an infra decision, not a
 *      product decision.
 *
 * The S3 implementation lives behind the same interface and is wired
 * in via `KYC_STORAGE_DRIVER=s3` (see the module). Defaults to `disk`
 * so the test suite + dev container Just Work.
 */
export interface KycStorage {
  /**
   * Persist a ciphertext blob and return the storage key that the
   * `KycDocument.fileKey` column points at. Implementations MUST hold
   * the bytes durably before resolving — the caller takes the row
   * insert as proof the blob is retrievable.
   */
  put(input: { userId: string; ciphertext: Buffer; mimeType: string }): Promise<string>;

  /** Stream the ciphertext bytes back out for admin review or user export. */
  get(fileKey: string): Promise<Buffer>;

  /**
   * Delete the underlying blob — called when an admin rejects + the
   * 90-day rejected-doc retention window elapses. Idempotent: returns
   * `false` if the key was already gone.
   */
  delete(fileKey: string): Promise<boolean>;
}

/**
 * Disk-backed storage for local dev + tests. Writes to
 * `<KYC_STORAGE_DIR>/kyc/<userId>/<uuid>.enc`. The `.enc` suffix is
 * cosmetic — the contents are already AES-256-GCM ciphertext.
 */
@Injectable()
export class DiskKycStorage implements KycStorage {
  private readonly logger = new Logger(DiskKycStorage.name);
  private readonly rootDir: string;

  constructor(rootDir?: string) {
    this.rootDir = rootDir ?? process.env.KYC_STORAGE_DIR ?? '/tmp/kalki-kyc';
  }

  async put(input: { userId: string; ciphertext: Buffer; mimeType: string }): Promise<string> {
    const dir = path.join(this.rootDir, 'kyc', input.userId);
    await fs.mkdir(dir, { recursive: true });
    const key = `kyc/${input.userId}/${randomUUID()}.enc`;
    const absPath = path.join(this.rootDir, key);
    await fs.writeFile(absPath, input.ciphertext);
    this.logger.debug(`stored ${input.ciphertext.length}B at ${key}`);
    return key;
  }

  async get(fileKey: string): Promise<Buffer> {
    return fs.readFile(path.join(this.rootDir, fileKey));
  }

  async delete(fileKey: string): Promise<boolean> {
    try {
      await fs.unlink(path.join(this.rootDir, fileKey));
      return true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }
}

/**
 * S3 implementation (PR-INFRA-S3-1). Writes ciphertext blobs to the
 * `kalki-kyc-encrypted` bucket with SSE-KMS using the
 * `alias/kalki/kyc` key.
 *
 * Two layers of encryption — by design:
 *
 *   1. Application-layer envelope (`document-cipher.ts`) — bytes are
 *      already AES-256-GCM-encrypted before they reach this storage
 *      layer. A leaked AWS root key can't decrypt them without also
 *      stealing `KYC_DOCUMENT_KEY` from the backend env.
 *   2. SSE-KMS — S3-managed encryption at rest with a KMS customer-
 *      managed key. A leaked S3 bucket dump can't be read without
 *      also having KMS Decrypt permission on the alias.
 *
 * Why dependency-free: same reasoning as `ses-sender.ts`. The
 * `@aws-sdk/client-s3` package + its peer-dep graph is ~12 MB
 * uncompressed and we'd only be using `PutObjectCommand` /
 * `GetObjectCommand` / `DeleteObjectCommand`. SigV4 + REST is
 * ~80 lines (shared with SES + KMS via `aws/sigv4.ts`) and gives us
 * the same surface. The trade-off costs us automatic retries and
 * connection pooling — fine for the KYC upload path which is
 * already user-driven and naturally retryable.
 *
 * Env vars (set in Helm via `kalki-shared` secret):
 *   AWS_REGION                            — e.g. ap-south-1
 *   AWS_ACCESS_KEY_ID                     — IAM user with kyc-bucket permissions
 *   AWS_SECRET_ACCESS_KEY                 — paired secret
 *   KYC_S3_BUCKET                         — default: kalki-kyc-encrypted
 *   KYC_S3_KMS_KEY_ID                     — KMS alias / ARN, default: alias/kalki/kyc
 *
 * Activation: `KYC_STORAGE_DRIVER=s3` (see kyc.module.ts).
 */
@Injectable()
export class S3KycStorage implements KycStorage {
  private readonly logger = new Logger(S3KycStorage.name);
  private readonly region: string;
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly sessionToken: string | undefined;
  private readonly bucket: string;
  private readonly kmsKeyId: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(fetchImpl?: typeof globalThis.fetch) {
    this.region = process.env.AWS_REGION ?? 'ap-south-1';
    this.accessKey = process.env.AWS_ACCESS_KEY_ID ?? '';
    this.secretKey = process.env.AWS_SECRET_ACCESS_KEY ?? '';
    this.sessionToken = process.env.AWS_SESSION_TOKEN || undefined;
    this.bucket = process.env.KYC_S3_BUCKET ?? 'kalki-kyc-encrypted';
    this.kmsKeyId = process.env.KYC_S3_KMS_KEY_ID ?? 'alias/kalki/kyc';
    this.fetchImpl = fetchImpl ?? globalThis.fetch;
  }

  /**
   * Path-style URL so the bucket name doesn't have to be DNS-safe.
   * Virtual-hosted style (`<bucket>.s3.<region>.amazonaws.com`) is
   * more common but breaks on bucket names with dots; path-style
   * (`s3.<region>.amazonaws.com/<bucket>`) works for every name.
   */
  private endpoint(key: string): string {
    return `https://s3.${this.region}.amazonaws.com/${this.bucket}/${key}`;
  }

  async put(input: { userId: string; ciphertext: Buffer; mimeType: string }): Promise<string> {
    this.assertCreds();
    const key = `kyc/${input.userId}/${randomUUID()}.enc`;
    const url = this.endpoint(key);

    // SSE-KMS headers — server-side encrypts the ciphertext (which
    // is already AES-256-GCM at the application layer) under a CMK.
    // Two-layer defence: leak the bucket → still need KMS access.
    const extraHeaders: Record<string, string> = {
      'content-type': input.mimeType,
      'content-length': String(input.ciphertext.length),
      'x-amz-server-side-encryption': 'aws:kms',
      'x-amz-server-side-encryption-aws-kms-key-id': this.kmsKeyId,
    };

    const { headers } = signRequest({
      method: 'PUT',
      url,
      service: 's3',
      region: this.region,
      accessKey: this.accessKey,
      secretKey: this.secretKey,
      sessionToken: this.sessionToken,
      body: input.ciphertext,
      extraHeaders,
    });

    const res = await this.fetchImpl(url, {
      method: 'PUT',
      headers,
      body: input.ciphertext as unknown as BodyInit,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`s3_put_failed status=${res.status} body=${text.slice(0, 200)}`);
    }
    this.logger.debug(`s3 put ${key} (${input.ciphertext.length}B)`);
    return key;
  }

  async get(fileKey: string): Promise<Buffer> {
    this.assertCreds();
    const url = this.endpoint(fileKey);
    const { headers } = signRequest({
      method: 'GET',
      url,
      service: 's3',
      region: this.region,
      accessKey: this.accessKey,
      secretKey: this.secretKey,
      sessionToken: this.sessionToken,
      body: '',
    });
    const res = await this.fetchImpl(url, { method: 'GET', headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`s3_get_failed status=${res.status} body=${text.slice(0, 200)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(fileKey: string): Promise<boolean> {
    this.assertCreds();
    const url = this.endpoint(fileKey);
    const { headers } = signRequest({
      method: 'DELETE',
      url,
      service: 's3',
      region: this.region,
      accessKey: this.accessKey,
      secretKey: this.secretKey,
      sessionToken: this.sessionToken,
      body: '',
    });
    const res = await this.fetchImpl(url, { method: 'DELETE', headers });
    // S3 DELETE returns 204 for both "deleted" and "didn't exist".
    // We can't distinguish here without an extra HeadObject round
    // trip — return true on 2xx, log + return false on 4xx/5xx.
    if (res.ok) return true;
    this.logger.warn(`s3 delete returned ${res.status} for ${fileKey}`);
    return false;
  }

  private assertCreds(): void {
    if (!this.accessKey || !this.secretKey) {
      throw new Error('s3_creds_missing: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY not set');
    }
  }
}
