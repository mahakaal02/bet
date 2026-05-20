import { SecretCipher, resolveCipherKey } from './secret-cipher';

describe('SecretCipher', () => {
  const cipher = new SecretCipher('kalki-test-totp-secret-key-32-chars!');

  it('round-trips an arbitrary buffer', () => {
    const plain = Buffer.from('deadbeef12345', 'utf8');
    const blob = cipher.encrypt(plain);
    expect(cipher.decrypt(blob).equals(plain)).toBe(true);
  });

  it('produces a v1.iv.ct.tag formatted blob', () => {
    const blob = cipher.encrypt(Buffer.from('x'));
    expect(blob).toMatch(/^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
  });

  it('different calls produce different ciphertexts (random IV)', () => {
    const a = cipher.encrypt(Buffer.from('same'));
    const b = cipher.encrypt(Buffer.from('same'));
    expect(a).not.toBe(b);
  });

  it('throws on tampered ciphertext (AES-GCM auth tag)', () => {
    const blob = cipher.encrypt(Buffer.from('hello'));
    const parts = blob.split('.');
    // Flip a bit in the ciphertext segment.
    const cipherBuf = Buffer.from(parts[2], 'base64');
    cipherBuf[0] ^= 0xff;
    const tampered = `${parts[0]}.${parts[1]}.${cipherBuf.toString('base64')}.${parts[3]}`;
    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it('throws on unknown version prefix', () => {
    expect(() => cipher.decrypt('v2.a.b.c')).toThrow(/unknown cipher format/);
  });

  it('rejects short keys at construction time', () => {
    expect(() => new SecretCipher('short')).toThrow();
    expect(() => new SecretCipher('')).toThrow();
    expect(() => new SecretCipher(undefined)).toThrow();
  });
});

describe('resolveCipherKey', () => {
  it('prefers the dedicated env var', () => {
    const env = {
      TOTP_SECRET_ENCRYPTION_KEY: 'super-long-dedicated-key-aaaaa',
      JWT_SECRET: 'jwt-only-secret-bbbbbbbbb',
    } as NodeJS.ProcessEnv;
    expect(resolveCipherKey(env)).toBe(env.TOTP_SECRET_ENCRYPTION_KEY);
  });

  it('falls back to JWT_SECRET in dev', () => {
    const env = {
      JWT_SECRET: 'jwt-only-secret-bbbbbbbbb',
    } as NodeJS.ProcessEnv;
    expect(resolveCipherKey(env)).toBe(env.JWT_SECRET);
  });

  it('uses a test-mode default when NODE_ENV=test', () => {
    const env = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
    expect(resolveCipherKey(env).length).toBeGreaterThanOrEqual(16);
  });

  it('throws when neither dedicated key nor JWT_SECRET is set (prod safety)', () => {
    const env = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
    expect(() => resolveCipherKey(env)).toThrow();
  });
});
