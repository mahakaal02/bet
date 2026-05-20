import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

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
 * KMS cipher stub. Real impl calls
 * `@aws-sdk/client-kms#EncryptCommand` with `KeyId=alias/kalki/kyc`
 * per document. Throws loud on use until PR-INFRA-KMS-1 wires the
 * dep + IAM role.
 */
@Injectable()
export class KmsDocumentCipher implements DocumentCipher {
  async encrypt(): Promise<{ ciphertext: Buffer; keyVersion: number }> {
    throw new Error('KmsDocumentCipher is a stub. See PR-INFRA-KMS-1.');
  }
  async decrypt(): Promise<Buffer> {
    throw new Error('KmsDocumentCipher is a stub. See PR-INFRA-KMS-1.');
  }
}
