import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assertSafeKey, DiskStorage, S3Storage } from './storage';
import { PassthroughImageProcessor } from './image-processor';

/**
 * Tests cover the Disk-storage round-trip end-to-end (real fs writes
 * under a tmp dir) plus all the path-traversal rejection paths and
 * the passthrough image processor's shape contract.
 *
 * The S3Storage stub is asserted to throw with a clear message —
 * a prod boot with STORAGE_DRIVER=s3 and unwired SDK should fail
 * loudly, not silently no-op (data loss otherwise).
 *
 * SharpImageProcessor is NOT unit tested here — the dep isn't
 * installed in CI by default. The interface-level contract (decode
 * failure, decompression-bomb refusal) lands when sharp is on the
 * image build per Roadmap §1H.
 */

describe('assertSafeKey', () => {
  it('passes well-formed keys', () => {
    expect(() => assertSafeKey('user-123/avatar-abc.jpg')).not.toThrow();
    expect(() => assertSafeKey('a.png')).not.toThrow();
  });
  it('rejects empty', () => {
    expect(() => assertSafeKey('')).toThrow(/empty/);
  });
  it('rejects oversize', () => {
    expect(() => assertSafeKey('a'.repeat(513))).toThrow(/too_long/);
  });
  it('rejects path traversal', () => {
    expect(() => assertSafeKey('../etc/passwd')).toThrow(/path_traversal/);
    expect(() => assertSafeKey('uploads/../etc')).toThrow(/path_traversal/);
  });
  it('rejects absolute paths', () => {
    expect(() => assertSafeKey('/etc/passwd')).toThrow(/absolute/);
  });
  it('rejects Windows drive letters', () => {
    expect(() => assertSafeKey('C:/Windows/system32')).toThrow(/absolute/);
    expect(() => assertSafeKey('C:\\Windows')).toThrow(/absolute/);
  });
});

describe('DiskStorage round-trip', () => {
  let tmpRoot: string;
  let storage: DiskStorage;

  beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalki-storage-test-'));
    storage = new DiskStorage(tmpRoot, '/test-base');
  });

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('puts then gets bytes verbatim', async () => {
    const payload = Buffer.from('hello, world');
    await storage.put({ bucket: 'avatars', key: 'u-1/abc.txt', bytes: payload, mimeType: 'text/plain' });
    const out = await storage.get({ bucket: 'avatars', key: 'u-1/abc.txt' });
    expect(out.equals(payload)).toBe(true);
  });

  it('creates nested directories on first put', async () => {
    const payload = Buffer.from('deep nested');
    await storage.put({ bucket: 'kyc', key: 'u-9/2026/05/22/doc.bin', bytes: payload, mimeType: 'application/octet-stream' });
    const out = await storage.get({ bucket: 'kyc', key: 'u-9/2026/05/22/doc.bin' });
    expect(out.equals(payload)).toBe(true);
  });

  it('delete returns true when removed, false when already gone', async () => {
    await storage.put({ bucket: 'avatars', key: 'u-2/del.jpg', bytes: Buffer.from('x'), mimeType: 'image/jpeg' });
    expect(await storage.delete({ bucket: 'avatars', key: 'u-2/del.jpg' })).toBe(true);
    expect(await storage.delete({ bucket: 'avatars', key: 'u-2/del.jpg' })).toBe(false);
  });

  it('urlFor uses the configured public base', () => {
    expect(storage.urlFor({ bucket: 'avatars', key: 'u-1/abc.jpg' })).toBe('/test-base/avatars/u-1/abc.jpg');
  });

  it('rejects unsafe keys on every entrypoint', async () => {
    await expect(
      storage.put({ bucket: 'avatars', key: '../etc/passwd', bytes: Buffer.from('x'), mimeType: 'text/plain' }),
    ).rejects.toThrow(/path_traversal/);
    await expect(
      storage.get({ bucket: 'avatars', key: '../etc/passwd' }),
    ).rejects.toThrow(/path_traversal/);
    await expect(
      storage.delete({ bucket: 'avatars', key: '../etc/passwd' }),
    ).rejects.toThrow(/path_traversal/);
  });

  it('rejects unsafe bucket names too', async () => {
    await expect(
      storage.put({ bucket: '../outside', key: 'a.png', bytes: Buffer.from('x'), mimeType: 'image/png' }),
    ).rejects.toThrow(/path_traversal/);
  });
});

describe('S3Storage stub', () => {
  it('throws on every method (loud-failure pattern)', async () => {
    const s3 = new S3Storage();
    await expect(s3.put({ bucket: 'a', key: 'b', bytes: Buffer.from('x'), mimeType: 'x' })).rejects.toThrow(/stub/);
    await expect(s3.get({ bucket: 'a', key: 'b' })).rejects.toThrow(/stub/);
    await expect(s3.delete({ bucket: 'a', key: 'b' })).rejects.toThrow(/stub/);
    expect(() => s3.urlFor({ bucket: 'a', key: 'b' })).toThrow(/stub/);
  });
});

describe('PassthroughImageProcessor', () => {
  it('returns input bytes + 0×0 dimensions + original mime', async () => {
    const p = new PassthroughImageProcessor();
    const input = Buffer.from('not-really-an-image');
    const result = await p.process({
      bytes: input,
      sourceMimeType: 'image/jpeg',
      targetWidth: 1600,
    });
    expect(result.bytes.equals(input)).toBe(true);
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
    expect(result.mimeType).toBe('image/jpeg');
  });
});
