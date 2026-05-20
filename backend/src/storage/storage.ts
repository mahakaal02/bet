import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Generic blob storage abstraction (Roadmap §1H / PR-BULK-IMG-1).
 *
 * Unifies the three previously-separate upload paths:
 *
 *   - avatar storage (was `profile.controller.ts`'s multer diskStorage)
 *   - KYC document storage (was `kyc/kyc-storage.ts`)
 *   - auction product images (was `uploads/uploads.controller.ts`)
 *
 * The differences across those paths were always cosmetic (different
 * directory prefix, different mime allowlist, different bucket in the
 * S3 future) — the underlying contract is the same:
 *
 *   "given some bytes + an intended logical key, persist them
 *    durably and return a key I can store on a DB row."
 *
 * Two implementations:
 *
 *   - `DiskStorage` — disk-backed under `<STORAGE_DIR>/<bucket>/<key>`.
 *     Default in dev/CI. No external deps. `urlFor` returns a
 *     `/uploads/<bucket>/<key>` path — same shape the existing
 *     auctions UI already serves from.
 *   - `S3Storage` — real impl lands in PR-INFRA-S3-1 (this PR ships
 *     the abstraction; S3 wiring is its own ticket). Stub throws
 *     loudly on use.
 *
 * Migrating callers:
 *
 *   The existing `KycStorage` / Multer disk-storage / Uploads
 *   controller all keep working — they're left as-is in this PR so
 *   the diff stays focused. The follow-up PR-MIGRATE-STORAGE wires
 *   each caller through `Storage` so the duplication can finally be
 *   deleted. This PR's job is just to land the shared contract +
 *   tests + the image processor that consumers will compose with it.
 */
export interface Storage {
  /**
   * Persist bytes under the given bucket + key. Implementations MUST
   * hold the bytes durably before resolving — the caller takes the
   * row insert as proof the blob is retrievable.
   *
   * `key` should be relative + path-traversal-safe (the impl validates).
   */
  put(input: { bucket: string; key: string; bytes: Buffer; mimeType: string }): Promise<{ key: string }>;

  /** Stream the bytes back out. */
  get(input: { bucket: string; key: string }): Promise<Buffer>;

  /**
   * Delete. Idempotent: returns `false` if the key was already gone
   * (so cleanup retries don't surface as errors).
   */
  delete(input: { bucket: string; key: string }): Promise<boolean>;

  /**
   * URL the *public-facing* surface should use to reference this
   * blob. For Disk this is a path on the same origin. For S3 it
   * will be either a CloudFront URL (public buckets) or a
   * presigned URL (encrypted-sensitive buckets like KYC).
   */
  urlFor(input: { bucket: string; key: string }): string;
}

/** Reject keys that try to escape the bucket directory. */
export function assertSafeKey(key: string): void {
  if (key.length === 0) throw new Error('storage_key_empty');
  if (key.length > 512) throw new Error('storage_key_too_long');
  // Posix path traversal.
  if (key.includes('..')) throw new Error('storage_key_path_traversal');
  // Windows drive letters / UNC.
  if (/^[A-Za-z]:[/\\]/.test(key) || key.startsWith('\\\\')) {
    throw new Error('storage_key_absolute');
  }
  if (key.startsWith('/')) throw new Error('storage_key_absolute');
}

@Injectable()
export class DiskStorage implements Storage {
  private readonly logger = new Logger(DiskStorage.name);
  private readonly rootDir: string;
  private readonly publicUrlBase: string;

  constructor(rootDir?: string, publicUrlBase?: string) {
    this.rootDir = rootDir ?? process.env.STORAGE_DIR ?? path.join(process.cwd(), 'uploads');
    // The user-facing URL prefix is /uploads by default — matches the
    // existing Nest static-file mount in main.ts.
    this.publicUrlBase = publicUrlBase ?? process.env.STORAGE_URL_BASE ?? '/uploads';
  }

  async put(input: { bucket: string; key: string; bytes: Buffer; mimeType: string }): Promise<{ key: string }> {
    assertSafeKey(input.key);
    assertSafeKey(input.bucket);
    const dir = path.join(this.rootDir, input.bucket, path.dirname(input.key));
    await fs.mkdir(dir, { recursive: true });
    const absPath = path.join(this.rootDir, input.bucket, input.key);
    await fs.writeFile(absPath, input.bytes);
    this.logger.debug(`stored ${input.bytes.length}B at ${input.bucket}/${input.key}`);
    return { key: input.key };
  }

  async get(input: { bucket: string; key: string }): Promise<Buffer> {
    assertSafeKey(input.key);
    assertSafeKey(input.bucket);
    return fs.readFile(path.join(this.rootDir, input.bucket, input.key));
  }

  async delete(input: { bucket: string; key: string }): Promise<boolean> {
    assertSafeKey(input.key);
    assertSafeKey(input.bucket);
    try {
      await fs.unlink(path.join(this.rootDir, input.bucket, input.key));
      return true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  urlFor(input: { bucket: string; key: string }): string {
    return `${this.publicUrlBase}/${input.bucket}/${input.key}`;
  }
}

/**
 * S3 stub — real impl lands in PR-INFRA-S3-1. Throwing rather than
 * silently no-op'ing because a prod boot with `STORAGE_DRIVER=s3`
 * + unwired SDK is an outage, not a graceful degradation.
 */
@Injectable()
export class S3Storage implements Storage {
  private static readonly UNWIRED = 'S3Storage is a stub. See PR-INFRA-S3-1.';
  async put(_input: { bucket: string; key: string; bytes: Buffer; mimeType: string }): Promise<{ key: string }> {
    throw new Error(S3Storage.UNWIRED);
  }
  async get(_input: { bucket: string; key: string }): Promise<Buffer> {
    throw new Error(S3Storage.UNWIRED);
  }
  async delete(_input: { bucket: string; key: string }): Promise<boolean> {
    throw new Error(S3Storage.UNWIRED);
  }
  urlFor(_input: { bucket: string; key: string }): string {
    throw new Error(S3Storage.UNWIRED);
  }
}
