import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { TwoFactorService } from './two-factor.service';
import * as totp from './totp';
import { base32encode } from './totp';

/**
 * Service tests for the TOTP lifecycle. The bcrypt + crypto layers are
 * exercised against real algorithms (no mocking) so the encryption,
 * hash, and verification paths get real coverage. The Prisma calls are
 * mocked with an in-memory map keyed by userId.
 *
 * Note: NODE_ENV is set to `test` so `resolveCipherKey()` accepts the
 * built-in dev key — see `secret-cipher.ts`.
 */

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
beforeAll(() => {
  process.env.NODE_ENV = 'test';
});
afterAll(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

interface MockRow {
  userId: string;
  encryptedSecret: string;
  verified: boolean;
  backupCodes: string[];
  enabledAt: Date | null;
  disabledAt: Date | null;
  createdAt: Date;
}

function makePrismaMock(opts: {
  initial2FA?: Partial<MockRow> | null;
  user?: { id: string; username: string; email: string | null; passwordHash: string } | null;
} = {}) {
  const rows = new Map<string, MockRow>();
  if (opts.initial2FA) {
    const r = opts.initial2FA;
    rows.set(r.userId ?? 'u-1', {
      userId: r.userId ?? 'u-1',
      encryptedSecret: r.encryptedSecret ?? '',
      verified: r.verified ?? false,
      backupCodes: r.backupCodes ?? [],
      enabledAt: r.enabledAt ?? null,
      disabledAt: r.disabledAt ?? null,
      createdAt: r.createdAt ?? new Date(),
    });
  }
  return {
    twoFactorAuth: {
      findUnique: jest.fn(async ({ where }: any) => rows.get(where.userId) ?? null),
      upsert: jest.fn(async ({ where, update, create }: any) => {
        const existing = rows.get(where.userId);
        if (existing) {
          const merged = { ...existing, ...update };
          rows.set(where.userId, merged);
          return merged;
        }
        const created: MockRow = {
          userId: where.userId,
          encryptedSecret: '',
          verified: false,
          backupCodes: [],
          enabledAt: null,
          disabledAt: null,
          createdAt: new Date(),
          ...create,
        };
        rows.set(where.userId, created);
        return created;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = rows.get(where.userId);
        if (!existing) throw new Error('no row');
        const merged = { ...existing, ...data };
        rows.set(where.userId, merged);
        return merged;
      }),
    },
    user: {
      findUnique: jest.fn(async () => opts.user ?? null),
    },
    _rows: rows,
  };
}

function makeNotificationsMock() {
  const enqueue = jest.fn(async (_args: any) => [] as unknown[]);
  return { enqueue };
}

function makeService(opts: Parameters<typeof makePrismaMock>[0] = {}) {
  const prisma = makePrismaMock(opts);
  const notifications = makeNotificationsMock();
  const config = { get: jest.fn(() => undefined) };
  const svc = new TwoFactorService(prisma as any, notifications as any, config as any);
  return { svc, prisma, notifications };
}

describe('TwoFactorService.status', () => {
  it('returns enrolled=false when no row exists', async () => {
    const { svc } = makeService({});
    expect(await svc.status('u-1')).toEqual({
      enrolled: false,
      enabled: false,
      enabledAt: null,
      backupCodesRemaining: 0,
    });
  });

  it('returns enabled=true for a verified row', async () => {
    const { svc } = makeService({
      initial2FA: {
        userId: 'u-1',
        verified: true,
        backupCodes: ['hashed1', 'hashed2'],
        enabledAt: new Date('2026-05-20'),
      },
    });
    const s = await svc.status('u-1');
    expect(s.enrolled).toBe(true);
    expect(s.enabled).toBe(true);
    expect(s.backupCodesRemaining).toBe(2);
  });

  it('returns enabled=false when disabledAt is set', async () => {
    const { svc } = makeService({
      initial2FA: { userId: 'u-1', verified: true, disabledAt: new Date() },
    });
    const s = await svc.status('u-1');
    expect(s.enabled).toBe(false);
  });
});

describe('TwoFactorService.beginEnrollment', () => {
  it('returns an otpauth URI + manual key + 10 backup codes', async () => {
    const { svc, prisma } = makeService({});
    const res = await svc.beginEnrollment('u-1', 'alice@kalki.local');
    expect(res.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(res.manualKey).toMatch(/^[A-Z2-7]+$/);
    expect(res.backupCodes).toHaveLength(10);
    // Codes are exposed in plaintext to the caller, hyphen-formatted.
    for (const code of res.backupCodes) {
      expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    }
    // Row was persisted.
    expect(prisma._rows.get('u-1')?.verified).toBe(false);
    expect(prisma._rows.get('u-1')?.backupCodes).toHaveLength(10);
  });

  it('refuses to re-enroll while 2FA is already verified', async () => {
    const { svc } = makeService({
      initial2FA: { userId: 'u-1', verified: true },
    });
    await expect(svc.beginEnrollment('u-1', 'a@b.c')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('replaces an unverified secret on re-enrollment (user re-scanned QR)', async () => {
    const { svc, prisma } = makeService({});
    const a = await svc.beginEnrollment('u-1', 'a@b.c');
    const b = await svc.beginEnrollment('u-1', 'a@b.c');
    expect(b.manualKey).not.toBe(a.manualKey);
    expect(prisma._rows.size).toBe(1);                       // still single row
  });
});

describe('TwoFactorService.verifyEnrollment', () => {
  it('flips verified=true on a matching code + enqueues notification', async () => {
    const { svc, prisma, notifications } = makeService({});
    const enroll = await svc.beginEnrollment('u-1', 'a@b.c');
    // Reverse-engineer the secret from the otpauth URI so we can
    // produce a current code (in real flow the user has it in their
    // authenticator app).
    const params = new URLSearchParams(enroll.otpauthUri.split('?')[1]);
    const base32Secret = params.get('secret')!;
    const secret = decodeBase32(base32Secret);
    const goodCode = totp.generate(secret);

    await svc.verifyEnrollment('u-1', goodCode);

    const row = prisma._rows.get('u-1')!;
    expect(row.verified).toBe(true);
    expect(row.enabledAt).toBeInstanceOf(Date);
    expect(notifications.enqueue).toHaveBeenCalledTimes(1);
    expect(notifications.enqueue.mock.calls[0][0].templateCode).toBe(
      '2fa_enabled_v1',
    );
  });

  it('rejects an invalid code with 401', async () => {
    const { svc } = makeService({});
    await svc.beginEnrollment('u-1', 'a@b.c');
    await expect(svc.verifyEnrollment('u-1', '000000')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects when 2FA already verified', async () => {
    const { svc } = makeService({
      initial2FA: { userId: 'u-1', verified: true, encryptedSecret: '' },
    });
    await expect(svc.verifyEnrollment('u-1', '123456')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects when no enrollment row exists', async () => {
    const { svc } = makeService({});
    await expect(svc.verifyEnrollment('u-1', '123456')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('TwoFactorService.verifyLogin', () => {
  it('accepts a fresh TOTP code', async () => {
    const { svc } = makeService({});
    const enroll = await svc.beginEnrollment('u-1', 'a@b.c');
    const secret = decodeBase32(
      new URLSearchParams(enroll.otpauthUri.split('?')[1]).get('secret')!,
    );
    await svc.verifyEnrollment('u-1', totp.generate(secret));

    await expect(svc.verifyLogin('u-1', totp.generate(secret))).resolves.toBeUndefined();
  });

  it('consumes a backup code on use (one-shot)', async () => {
    const { svc, prisma } = makeService({});
    const enroll = await svc.beginEnrollment('u-1', 'a@b.c');
    const secret = decodeBase32(
      new URLSearchParams(enroll.otpauthUri.split('?')[1]).get('secret')!,
    );
    await svc.verifyEnrollment('u-1', totp.generate(secret));

    const code = enroll.backupCodes[0];
    await expect(svc.verifyLogin('u-1', code)).resolves.toBeUndefined();

    // Second use of the same backup code must fail (no longer stored).
    await expect(svc.verifyLogin('u-1', code)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma._rows.get('u-1')!.backupCodes).toHaveLength(9);
  });

  it('rejects when 2FA is not verified', async () => {
    const { svc } = makeService({});
    await svc.beginEnrollment('u-1', 'a@b.c');
    await expect(svc.verifyLogin('u-1', '123456')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('locks out after 5 failed attempts within 5 minutes', async () => {
    const { svc } = makeService({});
    const enroll = await svc.beginEnrollment('u-1', 'a@b.c');
    const secret = decodeBase32(
      new URLSearchParams(enroll.otpauthUri.split('?')[1]).get('secret')!,
    );
    await svc.verifyEnrollment('u-1', totp.generate(secret));

    for (let i = 0; i < 5; i++) {
      await expect(svc.verifyLogin('u-1', '000000')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    // 6th attempt is the lockout — even a correct code is rejected
    // until the cooldown passes.
    await expect(svc.verifyLogin('u-1', totp.generate(secret))).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});

describe('TwoFactorService.disable', () => {
  it('requires password + valid second factor; revokes secret + codes', async () => {
    const passwordHash = await bcrypt.hash('password123', 10);
    const { svc, prisma, notifications } = makeService({
      user: {
        id: 'u-1',
        username: 'alice',
        email: 'a@b.c',
        passwordHash,
      },
    });
    const enroll = await svc.beginEnrollment('u-1', 'a@b.c');
    const secret = decodeBase32(
      new URLSearchParams(enroll.otpauthUri.split('?')[1]).get('secret')!,
    );
    await svc.verifyEnrollment('u-1', totp.generate(secret));

    await svc.disable('u-1', 'password123', totp.generate(secret));

    const row = prisma._rows.get('u-1')!;
    expect(row.verified).toBe(false);
    expect(row.encryptedSecret).toBe('');
    expect(row.backupCodes).toEqual([]);
    expect(row.disabledAt).toBeInstanceOf(Date);
    expect(notifications.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ templateCode: '2fa_disabled_v1' }),
    );
  });

  it('rejects a wrong password before checking the code', async () => {
    const passwordHash = await bcrypt.hash('password123', 10);
    const { svc } = makeService({
      user: { id: 'u-1', username: 'a', email: null, passwordHash },
    });
    const enroll = await svc.beginEnrollment('u-1', 'a@b.c');
    const secret = decodeBase32(
      new URLSearchParams(enroll.otpauthUri.split('?')[1]).get('secret')!,
    );
    await svc.verifyEnrollment('u-1', totp.generate(secret));

    await expect(
      svc.disable('u-1', 'WRONG', totp.generate(secret)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('TwoFactorService.regenerateBackupCodes', () => {
  it('returns a fresh set of 10 codes when 2FA is enabled', async () => {
    const { svc, prisma } = makeService({});
    const enroll = await svc.beginEnrollment('u-1', 'a@b.c');
    const secret = decodeBase32(
      new URLSearchParams(enroll.otpauthUri.split('?')[1]).get('secret')!,
    );
    await svc.verifyEnrollment('u-1', totp.generate(secret));
    const oldHashes = prisma._rows.get('u-1')!.backupCodes;

    const next = await svc.regenerateBackupCodes('u-1');
    expect(next).toHaveLength(10);
    const newHashes = prisma._rows.get('u-1')!.backupCodes;
    expect(newHashes).not.toEqual(oldHashes);
  });

  it('refuses to regenerate before 2FA is verified', async () => {
    const { svc } = makeService({});
    await svc.beginEnrollment('u-1', 'a@b.c');
    await expect(svc.regenerateBackupCodes('u-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

// Helper: decode RFC 4648 base32 (uppercase, no padding) — mirrors
// the encoder in `totp.ts` so tests can recover the secret from
// the otpauth URI.
function decodeBase32(s: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of s) {
    const idx = alphabet.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// Reference base32encode to keep TS happy when it's imported but
// only used in the helper above's mirror.
void base32encode;
