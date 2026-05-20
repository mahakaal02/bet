import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

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
 * S3 stub. The real implementation reaches for `@aws-sdk/client-s3`
 * and writes to the `kalki-kyc-encrypted` bucket with SSE-KMS using
 * the `kalki/kyc` key. We're not pulling that dep in until the infra
 * PR provisions the bucket (Roadmap §1H); until then this stub throws
 * loud so a misconfigured prod boot fails fast rather than silently
 * dropping documents.
 */
@Injectable()
export class S3KycStorage implements KycStorage {
  async put(): Promise<string> {
    throw new Error(
      'S3KycStorage is a stub. Provision @aws-sdk/client-s3 + the kalki-kyc-encrypted bucket and replace this with the real impl. See PR-INFRA-S3-1.',
    );
  }
  async get(): Promise<Buffer> {
    throw new Error('S3KycStorage stub. See PR-INFRA-S3-1.');
  }
  async delete(): Promise<boolean> {
    throw new Error('S3KycStorage stub. See PR-INFRA-S3-1.');
  }
}
