import * as crypto from 'crypto';

/**
 * Symmetric envelope for TOTP secrets at rest. Until KMS lands
 * (Roadmap §5.5), the key is derived from an env var
 * `TOTP_SECRET_ENCRYPTION_KEY`. If that's unset (dev), we fall
 * back to a stretch of `JWT_SECRET` — the dev box already trusts
 * that secret, so a leak of one means a leak of the other.
 *
 * Format on disk: `v1.<base64(iv)>.<base64(ciphertext)>.<base64(tag)>`
 * with AES-256-GCM. A version prefix means we can rotate algorithms
 * later by writing a `v2.` reader without touching v1 rows.
 *
 * Tampering: AES-GCM provides authenticated encryption — flipping
 * a bit in ciphertext fails the auth tag, `decrypt()` throws. No
 * silent corruption.
 *
 * What this is NOT: a defence against a fully compromised process.
 * If the attacker has runtime access to the env, they have the
 * key. The bar is "exfiltrating a Postgres dump is useless without
 * also reading the env".
 */
export class SecretCipher {
  private readonly key: Buffer;

  constructor(rawKey?: string) {
    if (!rawKey || rawKey.length < 16) {
      throw new Error(
        'SecretCipher requires a key of at least 16 chars. Set TOTP_SECRET_ENCRYPTION_KEY in env.',
      );
    }
    // Stretch the key to a fixed 32 bytes via sha256 so any caller-
    // supplied length is acceptable.
    this.key = crypto.createHash('sha256').update(rawKey, 'utf8').digest();
  }

  encrypt(plaintext: Buffer): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64')}.${ct.toString('base64')}.${tag.toString('base64')}`;
  }

  decrypt(blob: string): Buffer {
    const parts = blob.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') {
      throw new Error(
        `unknown cipher format (got "${parts[0]}", expected "v1.<iv>.<ct>.<tag>")`,
      );
    }
    const iv = Buffer.from(parts[1], 'base64');
    const ct = Buffer.from(parts[2], 'base64');
    const tag = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }
}

/**
 * Resolve the encryption key from config, with a dev fallback to
 * `JWT_SECRET`. Throws if NEITHER is set so production deploys
 * fail loudly instead of silently writing rows under a bad key.
 */
export function resolveCipherKey(env: NodeJS.ProcessEnv): string {
  const dedicated = env.TOTP_SECRET_ENCRYPTION_KEY;
  if (dedicated && dedicated.length >= 16) return dedicated;
  const jwt = env.JWT_SECRET;
  if (jwt && jwt.length >= 16) return jwt;
  if (env.NODE_ENV === 'test') return 'kalki-test-totp-secret-key-32-chars!';
  throw new Error(
    'Neither TOTP_SECRET_ENCRYPTION_KEY nor JWT_SECRET is set — refusing to start the 2FA service without a key.',
  );
}
