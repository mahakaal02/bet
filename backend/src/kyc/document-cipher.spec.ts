import * as crypto from 'crypto';
import { KmsDocumentCipher, LocalKeyDocumentCipher } from './document-cipher';

/**
 * LocalKeyDocumentCipher is exercised indirectly by the KYC service
 * tests. Here we lock down:
 *
 *   1. KMS envelope round-trip: GenerateDataKey → Encrypt → Decrypt
 *      survives the wire format and recovers the plaintext.
 *   2. Envelope layout: version byte = 100, wrapped-key length
 *      prefix is honoured.
 *   3. Tamper detection: flipping a ciphertext byte fails the GCM
 *      tag and refuses to return plaintext.
 *   4. Version mismatch on decrypt: column-vs-blob disagreement
 *      throws (catches row corruption / migration bugs).
 *   5. Missing creds: encrypt/decrypt throw rather than silently
 *      sending un-signed requests.
 *
 * "Fake KMS" is just a fetchImpl that:
 *   - On GenerateDataKey: returns a randomly-generated 32-byte DEK
 *     + a synthetic wrapped blob keyed off the DEK (so the same
 *     wrapped value round-trips back).
 *   - On Decrypt: looks up the DEK from the wrapped blob and
 *     returns it.
 * That lets the tests assert the full encrypt-then-decrypt cycle
 * end-to-end without a real KMS endpoint.
 */

/**
 * Build a fake KMS endpoint backed by an in-memory wrapped-key map.
 * Returns both the fetchImpl and the spy `calls` array so individual
 * tests can assert what was requested.
 */
function makeFakeKms(): {
  fetchImpl: ConstructorParameters<typeof KmsDocumentCipher>[0];
  calls: Array<{ target: string; body: string }>;
} {
  const wrapped = new Map<string, Buffer>();
  const calls: Array<{ target: string; body: string }> = [];
  const fetchImpl: ConstructorParameters<typeof KmsDocumentCipher>[0] = async (
    _url,
    init,
  ) => {
    const target = (init?.headers ?? {})['x-amz-target'] as string;
    const body = init?.body ?? '';
    calls.push({ target, body });
    if (target === 'TrentService.GenerateDataKey') {
      const dek = crypto.randomBytes(32);
      // Synthetic "wrapped" form — a sentinel prefix + a random
      // suffix used as the lookup key. Real KMS wraps under the CMK;
      // we just need a stable opaque blob the Decrypt mock can map
      // back to the DEK.
      const handle = crypto.randomBytes(16);
      const wrappedBlob = Buffer.concat([Buffer.from('wrap:'), handle]);
      wrapped.set(handle.toString('hex'), dek);
      return {
        ok: true,
        status: 200,
        async text() { return ''; },
        async json() {
          return {
            KeyId: 'arn:aws:kms:test:fake',
            Plaintext: dek.toString('base64'),
            CiphertextBlob: wrappedBlob.toString('base64'),
          };
        },
      };
    }
    if (target === 'TrentService.Decrypt') {
      const parsed = JSON.parse(body) as { CiphertextBlob: string };
      const blob = Buffer.from(parsed.CiphertextBlob, 'base64');
      // Strip the sentinel prefix and look up the DEK.
      const handle = blob.subarray(5).toString('hex');
      const dek = wrapped.get(handle);
      if (!dek) {
        return {
          ok: false, status: 400,
          async text() { return JSON.stringify({ __type: 'InvalidCiphertextException' }); },
          async json() { return {}; },
        };
      }
      return {
        ok: true, status: 200,
        async text() { return ''; },
        async json() {
          return {
            KeyId: 'arn:aws:kms:test:fake',
            Plaintext: dek.toString('base64'),
          };
        },
      };
    }
    return {
      ok: false, status: 400,
      async text() { return 'unknown target'; },
      async json() { return {}; },
    };
  };
  return { fetchImpl, calls };
}

describe('KmsDocumentCipher', () => {
  const PRIOR_ENV = process.env;

  beforeEach(() => {
    // Stable env so signRequest produces deterministic-ish output
    // (the timestamp still varies but we don't pin on it).
    process.env = {
      ...PRIOR_ENV,
      AWS_REGION: 'ap-south-1',
      AWS_ACCESS_KEY_ID: 'AKIAFAKE',
      AWS_SECRET_ACCESS_KEY: 'SECRETFAKE',
      KYC_KMS_KEY_ID: 'alias/kalki/kyc-test',
    };
    delete process.env.AWS_SESSION_TOKEN;
  });

  afterEach(() => {
    process.env = PRIOR_ENV;
  });

  it('encrypt → decrypt round-trips a small payload', async () => {
    const { fetchImpl } = makeFakeKms();
    const cipher = new KmsDocumentCipher(fetchImpl);
    const plaintext = Buffer.from('passport-scan-bytes', 'utf8');

    const { ciphertext, keyVersion } = await cipher.encrypt(plaintext);
    expect(keyVersion).toBe(100); // KMS_ENVELOPE_V1
    expect(ciphertext[0]).toBe(100);
    // Ciphertext must be strictly larger than the plaintext (header +
    // wrapped key + IV + tag).
    expect(ciphertext.length).toBeGreaterThan(plaintext.length + 30);

    const recovered = await cipher.decrypt(ciphertext, keyVersion);
    expect(recovered.equals(plaintext)).toBe(true);
  });

  it('encrypt → decrypt round-trips a 1MB payload', async () => {
    const { fetchImpl } = makeFakeKms();
    const cipher = new KmsDocumentCipher(fetchImpl);
    const big = crypto.randomBytes(1024 * 1024);

    const { ciphertext, keyVersion } = await cipher.encrypt(big);
    const recovered = await cipher.decrypt(ciphertext, keyVersion);
    expect(recovered.equals(big)).toBe(true);
  });

  it('issues exactly one GenerateDataKey + one Decrypt per round-trip', async () => {
    const { fetchImpl, calls } = makeFakeKms();
    const cipher = new KmsDocumentCipher(fetchImpl);
    const { ciphertext, keyVersion } = await cipher.encrypt(Buffer.from('hi'));
    expect(calls.filter((c) => c.target === 'TrentService.GenerateDataKey')).toHaveLength(1);
    await cipher.decrypt(ciphertext, keyVersion);
    expect(calls.filter((c) => c.target === 'TrentService.Decrypt')).toHaveLength(1);
  });

  it('sends the configured KMS KeyId on GenerateDataKey', async () => {
    const { fetchImpl, calls } = makeFakeKms();
    const cipher = new KmsDocumentCipher(fetchImpl);
    await cipher.encrypt(Buffer.from('x'));
    const gen = calls.find((c) => c.target === 'TrentService.GenerateDataKey');
    expect(gen).toBeDefined();
    const body = JSON.parse(gen!.body) as { KeyId: string; KeySpec: string };
    expect(body.KeyId).toBe('alias/kalki/kyc-test');
    expect(body.KeySpec).toBe('AES_256');
  });

  it('rejects decrypt with mismatched column version', async () => {
    const { fetchImpl } = makeFakeKms();
    const cipher = new KmsDocumentCipher(fetchImpl);
    const { ciphertext, keyVersion } = await cipher.encrypt(Buffer.from('whatever'));
    expect(keyVersion).toBe(100);
    await expect(cipher.decrypt(ciphertext, 99)).rejects.toThrow(/version/);
  });

  it('rejects unknown envelope version byte', async () => {
    const { fetchImpl } = makeFakeKms();
    const cipher = new KmsDocumentCipher(fetchImpl);
    const { ciphertext } = await cipher.encrypt(Buffer.from('hi'));
    const tampered = Buffer.from(ciphertext);
    tampered.writeUInt8(101, 0); // bump version byte to an unknown one
    await expect(cipher.decrypt(tampered, 101)).rejects.toThrow(/Unknown KMS envelope/);
  });

  it('rejects tampered ciphertext (GCM auth tag fails)', async () => {
    const { fetchImpl } = makeFakeKms();
    const cipher = new KmsDocumentCipher(fetchImpl);
    const { ciphertext, keyVersion } = await cipher.encrypt(Buffer.from('passport'));
    const tampered = Buffer.from(ciphertext);
    // Flip the last byte (always in the ciphertext segment).
    tampered[tampered.length - 1] ^= 0x01;
    await expect(cipher.decrypt(tampered, keyVersion)).rejects.toThrow();
  });

  it('rejects truncated blobs', async () => {
    const { fetchImpl } = makeFakeKms();
    const cipher = new KmsDocumentCipher(fetchImpl);
    await expect(cipher.decrypt(Buffer.from([100, 0, 0]), 100)).rejects.toThrow(/truncated/);
  });

  it('throws if AWS creds are missing on encrypt', async () => {
    process.env.AWS_ACCESS_KEY_ID = '';
    const { fetchImpl } = makeFakeKms();
    const cipher = new KmsDocumentCipher(fetchImpl);
    await expect(cipher.encrypt(Buffer.from('x'))).rejects.toThrow(/AWS_ACCESS_KEY_ID/);
  });

  it('throws if AWS creds are missing on decrypt', async () => {
    process.env.AWS_SECRET_ACCESS_KEY = '';
    const { fetchImpl } = makeFakeKms();
    const cipher = new KmsDocumentCipher(fetchImpl);
    await expect(cipher.decrypt(Buffer.alloc(50, 100), 100)).rejects.toThrow(/AWS_ACCESS_KEY_ID/);
  });

  it('surfaces KMS HTTP errors', async () => {
    const fetchImpl: ConstructorParameters<typeof KmsDocumentCipher>[0] = async () => ({
      ok: false,
      status: 403,
      async text() { return JSON.stringify({ __type: 'AccessDeniedException' }); },
      async json() { return {}; },
    });
    const cipher = new KmsDocumentCipher(fetchImpl);
    await expect(cipher.encrypt(Buffer.from('x'))).rejects.toThrow(/kms_call_failed.*403/);
  });

  it('refuses an unexpected DEK length from KMS', async () => {
    const fetchImpl: ConstructorParameters<typeof KmsDocumentCipher>[0] = async () => ({
      ok: true,
      status: 200,
      async text() { return ''; },
      async json() {
        return {
          KeyId: 'arn:aws:kms:test:fake',
          // 16 bytes instead of 32 — would be AES-128, not what we asked.
          Plaintext: Buffer.alloc(16).toString('base64'),
          CiphertextBlob: Buffer.from('wrap:xx').toString('base64'),
        };
      },
    });
    const cipher = new KmsDocumentCipher(fetchImpl);
    await expect(cipher.encrypt(Buffer.from('x'))).rejects.toThrow(/unexpected DEK length/);
  });
});

describe('LocalKeyDocumentCipher (regression — KMS PR must not break local)', () => {
  it('still round-trips with the existing envelope', async () => {
    const cipher = new LocalKeyDocumentCipher('a'.repeat(32), 1);
    const { ciphertext, keyVersion } = await cipher.encrypt(Buffer.from('hello'));
    expect(keyVersion).toBe(1);
    expect(ciphertext[0]).toBe(1); // version byte in local 1-99 range
    const recovered = await cipher.decrypt(ciphertext, keyVersion);
    expect(recovered.toString('utf8')).toBe('hello');
  });
});
