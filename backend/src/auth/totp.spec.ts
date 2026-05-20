import { base32encode, generate, otpauthUri, randomSecret, verify } from './totp';

/**
 * TOTP test vectors drawn from RFC 6238 Appendix B (SHA1 variant).
 * They pin our implementation to the standard so a future tweak that
 * silently drifts (clock offset, big-endian mistake, truncation bit
 * count) is caught here.
 *
 * The RFC vectors use a 20-byte ASCII secret "12345678901234567890".
 */
const RFC6238_SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('TOTP — RFC 6238 vectors', () => {
  const cases: Array<[number, string]> = [
    [59 * 1000, '287082'],
    [1111111109 * 1000, '081804'],
    [1111111111 * 1000, '050471'],
    [1234567890 * 1000, '005924'],
    [2000000000 * 1000, '279037'],
  ];
  for (const [nowMs, expected] of cases) {
    it(`matches RFC vector at t=${nowMs / 1000}s → ${expected}`, () => {
      expect(generate(RFC6238_SECRET, nowMs)).toBe(expected);
    });
  }
});

describe('TOTP verify', () => {
  const secret = RFC6238_SECRET;
  const t = 1111111111 * 1000;                                 // 050471

  it('accepts a code from the current window', () => {
    expect(verify(secret, '050471', t)).toBe(true);
  });

  it('accepts a code from the previous window (clock-drift tolerance)', () => {
    const prev = generate(secret, t - 30_000);
    expect(verify(secret, prev, t)).toBe(true);
  });

  it('accepts a code from the next window (clock-drift tolerance)', () => {
    const next = generate(secret, t + 30_000);
    expect(verify(secret, next, t)).toBe(true);
  });

  it('rejects a code from two windows ago', () => {
    const stale = generate(secret, t - 90_000);
    expect(verify(secret, stale, t)).toBe(false);
  });

  it('rejects malformed codes (letters, wrong length)', () => {
    expect(verify(secret, '12345', t)).toBe(false);
    expect(verify(secret, '1234567', t)).toBe(false);
    expect(verify(secret, 'abcdef', t)).toBe(false);
    expect(verify(secret, '', t)).toBe(false);
  });

  it('tolerates whitespace around the code', () => {
    expect(verify(secret, '  050471  ', t)).toBe(true);
    expect(verify(secret, '050 471', t)).toBe(true);
  });

  it('zero-padded codes work (real risk: scanner returns "5924" not "005924")', () => {
    expect(verify(secret, '005924', 1234567890 * 1000)).toBe(true);
  });
});

describe('base32 encoding', () => {
  it('encodes 20 zero bytes to AAAA…', () => {
    const z = Buffer.alloc(20);
    expect(base32encode(z)).toBe('A'.repeat(32));
  });

  it('round-trips a known input ("foobar")', () => {
    // Standard test vector from RFC 4648 §10.
    expect(base32encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });
});

describe('otpauthUri', () => {
  it('embeds secret + issuer + algorithm + period + digits', () => {
    const uri = otpauthUri({
      secret: Buffer.from('hello'),
      issuer: 'Kalki',
      accountName: 'alice@kalki.local',
    });
    expect(uri).toMatch(/^otpauth:\/\/totp\/Kalki%3Aalice%40kalki\.local\?/);
    expect(uri).toContain('issuer=Kalki');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('period=30');
    expect(uri).toContain('digits=6');
    expect(uri).toContain(`secret=${base32encode(Buffer.from('hello'))}`);
  });
});

describe('randomSecret', () => {
  it('returns 20 bytes of entropy', () => {
    const s = randomSecret();
    expect(s).toBeInstanceOf(Buffer);
    expect(s.length).toBe(20);
  });

  it('yields a distinct value on each call', () => {
    expect(randomSecret().equals(randomSecret())).toBe(false);
  });
});
