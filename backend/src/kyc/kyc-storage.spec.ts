import { S3KycStorage } from './kyc-storage';

/**
 * S3KycStorage unit tests. The `fetchImpl` constructor parameter
 * makes the impl directly testable without LocalStack — every test
 * verifies the SigV4 request shape against a stub fetch.
 *
 * What's covered:
 *   - PUT sends the ciphertext as the body + SSE-KMS headers +
 *     SigV4 Authorization header.
 *   - GET reads the body back and surfaces it as a Buffer.
 *   - DELETE returns true on 2xx, false on 4xx.
 *   - Missing AWS creds throws loudly (not a silent no-op).
 *   - 5xx surfaces as Error with the body excerpt for log triage.
 *
 * What's NOT covered: the actual S3 server behaviour. Integration
 * tests against LocalStack are in `test/integration/kyc-s3.spec.ts`
 * (skipped under unit-test runs — they require docker-compose).
 */

function makeFetchMock(responses: Array<{ status: number; body: Buffer | string }>) {
  let i = 0;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    const res = responses[i] ?? responses[responses.length - 1];
    i += 1;
    calls.push({ url: String(url), init: init ?? {} });
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      text: async () => (typeof res.body === 'string' ? res.body : res.body.toString('utf8')),
      arrayBuffer: async () => {
        const buf = typeof res.body === 'string' ? Buffer.from(res.body) : res.body;
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      },
    } as unknown as Response;
  };
  return { fetchImpl: fetchImpl as unknown as typeof globalThis.fetch, _calls: () => calls };
}

describe('S3KycStorage.put', () => {
  beforeEach(() => {
    process.env.AWS_REGION = 'ap-south-1';
    process.env.AWS_ACCESS_KEY_ID = 'AKIA-TEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-test';
    process.env.KYC_S3_BUCKET = 'kalki-kyc-test';
    process.env.KYC_S3_KMS_KEY_ID = 'alias/kalki/test';
    delete process.env.AWS_SESSION_TOKEN;
  });

  it('PUTs ciphertext to the expected URL with SSE-KMS headers + SigV4', async () => {
    const { fetchImpl, _calls } = makeFetchMock([{ status: 200, body: '' }]);
    const storage = new S3KycStorage(fetchImpl);
    const ciphertext = Buffer.from('ENCRYPTED_PAYLOAD');
    const key = await storage.put({ userId: 'u-1', ciphertext, mimeType: 'image/jpeg' });

    expect(key).toMatch(/^kyc\/u-1\/[0-9a-f-]+\.enc$/);
    expect(_calls()).toHaveLength(1);
    const { url, init } = _calls()[0];
    expect(url).toBe(`https://s3.ap-south-1.amazonaws.com/kalki-kyc-test/${key}`);
    expect(init.method).toBe('PUT');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-amz-server-side-encryption']).toBe('aws:kms');
    expect(headers['x-amz-server-side-encryption-aws-kms-key-id']).toBe('alias/kalki/test');
    expect(headers.authorization).toMatch(/AWS4-HMAC-SHA256 Credential=AKIA-TEST/);
    expect(init.body).toBe(ciphertext as unknown);
  });

  it('throws loud when AWS creds are missing', async () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    const { fetchImpl } = makeFetchMock([{ status: 200, body: '' }]);
    const storage = new S3KycStorage(fetchImpl);
    await expect(
      storage.put({ userId: 'u-1', ciphertext: Buffer.from('x'), mimeType: 'image/jpeg' }),
    ).rejects.toThrow(/creds_missing/);
  });

  it('surfaces 5xx with status + body excerpt', async () => {
    const { fetchImpl } = makeFetchMock([{ status: 503, body: '<Error>SlowDown</Error>' }]);
    const storage = new S3KycStorage(fetchImpl);
    await expect(
      storage.put({ userId: 'u-1', ciphertext: Buffer.from('x'), mimeType: 'image/jpeg' }),
    ).rejects.toThrow(/status=503/);
  });

  it('includes session token when AWS_SESSION_TOKEN is set (IAM role path)', async () => {
    process.env.AWS_SESSION_TOKEN = 'FwoGZXIv-SESSION-TOKEN-EXAMPLE';
    const { fetchImpl, _calls } = makeFetchMock([{ status: 200, body: '' }]);
    const storage = new S3KycStorage(fetchImpl);
    await storage.put({ userId: 'u-1', ciphertext: Buffer.from('x'), mimeType: 'image/jpeg' });
    const headers = _calls()[0].init.headers as Record<string, string>;
    expect(headers['x-amz-security-token']).toBe('FwoGZXIv-SESSION-TOKEN-EXAMPLE');
  });
});

describe('S3KycStorage.get', () => {
  beforeEach(() => {
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_ACCESS_KEY_ID = 'AKIA-TEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-test';
    process.env.KYC_S3_BUCKET = 'kalki-kyc';
  });

  it('GETs and returns the body as a Buffer', async () => {
    const payload = Buffer.from('ciphertext-bytes');
    const { fetchImpl, _calls } = makeFetchMock([{ status: 200, body: payload }]);
    const storage = new S3KycStorage(fetchImpl);
    const result = await storage.get('kyc/u-1/abc.enc');
    expect(result.equals(payload)).toBe(true);
    expect(_calls()[0].init.method).toBe('GET');
  });

  it('throws on 4xx with body excerpt', async () => {
    const { fetchImpl } = makeFetchMock([{ status: 404, body: '<Error>NoSuchKey</Error>' }]);
    const storage = new S3KycStorage(fetchImpl);
    await expect(storage.get('kyc/u-1/missing.enc')).rejects.toThrow(/status=404/);
  });
});

describe('S3KycStorage.delete', () => {
  beforeEach(() => {
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_ACCESS_KEY_ID = 'AKIA-TEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-test';
    process.env.KYC_S3_BUCKET = 'kalki-kyc';
  });

  it('returns true on 204 (deleted) and 200', async () => {
    const a = makeFetchMock([{ status: 204, body: '' }]);
    const b = makeFetchMock([{ status: 200, body: '' }]);
    expect(await new S3KycStorage(a.fetchImpl).delete('kyc/x.enc')).toBe(true);
    expect(await new S3KycStorage(b.fetchImpl).delete('kyc/x.enc')).toBe(true);
  });

  it('returns false on 4xx (logged, not thrown)', async () => {
    const { fetchImpl } = makeFetchMock([{ status: 403, body: 'AccessDenied' }]);
    expect(await new S3KycStorage(fetchImpl).delete('kyc/x.enc')).toBe(false);
  });
});
