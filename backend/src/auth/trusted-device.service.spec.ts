import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TrustedDeviceService } from './trusted-device.service';

/**
 * TrustedDeviceService tests. Covers:
 *
 *   1. mint() — fresh row, sha256 hash stored, cookie value returned
 *      in plaintext exactly once.
 *   2. verify() — accept-on-match, reject-on-miss, reject-on-expired,
 *      lastSeenAt is bumped.
 *   3. Cap eviction — minting beyond MAX_DEVICES evicts the oldest.
 *   4. revoke() / revokeAll() — pull expiresAt to now; ownership
 *      guard rejects revoking another user's device.
 *   5. labelFor() — UA-parsing fallback chain.
 */

interface MockRow {
  id: string;
  userId: string;
  deviceHash: string;
  label: string | null;
  lastSeenAt: Date;
  expiresAt: Date;
}

function makePrismaMock(initial: MockRow[] = []) {
  const rows: MockRow[] = [...initial];
  let next = rows.length + 1;
  return {
    trustedDevice: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id) return rows.find((r) => r.id === where.id) ?? null;
        if (where.userId_deviceHash) {
          const { userId, deviceHash } = where.userId_deviceHash;
          return (
            rows.find(
              (r) => r.userId === userId && r.deviceHash === deviceHash,
            ) ?? null
          );
        }
        return null;
      }),
      findMany: jest.fn(async ({ where, orderBy }: any) => {
        let pool = rows.filter((r) => {
          if (where.userId && r.userId !== where.userId) return false;
          if (where.expiresAt?.gt && r.expiresAt.getTime() <= Date.now())
            return false;
          return true;
        });
        if (orderBy?.lastSeenAt === 'asc') {
          pool = pool
            .slice()
            .sort(
              (a, b) => a.lastSeenAt.getTime() - b.lastSeenAt.getTime(),
            );
        } else if (orderBy?.lastSeenAt === 'desc') {
          pool = pool
            .slice()
            .sort(
              (a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime(),
            );
        }
        return pool;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row: MockRow = {
          id: `td-${next++}`,
          userId: data.userId,
          deviceHash: data.deviceHash,
          label: data.label ?? null,
          lastSeenAt: data.lastSeenAt ?? new Date(),
          expiresAt: data.expiresAt,
        };
        rows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id);
        if (!r) throw new Error(`no row ${where.id}`);
        Object.assign(r, data);
        return r;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let n = 0;
        for (const r of rows) {
          if (where.id?.in && !where.id.in.includes(r.id)) continue;
          if (where.userId && r.userId !== where.userId) continue;
          if (where.expiresAt?.gt && r.expiresAt.getTime() <= Date.now())
            continue;
          Object.assign(r, data);
          n += 1;
        }
        return { count: n };
      }),
    },
    _rows: (): MockRow[] => rows,
  };
}

function makeService(initial: MockRow[] = []) {
  const prisma = makePrismaMock(initial);
  return { svc: new TrustedDeviceService(prisma as any), prisma };
}

const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15';
const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ─── mint ──────────────────────────────────────────────────────────

describe('TrustedDeviceService.mint', () => {
  it('returns a 64-char hex cookie value + writes the sha256 hash', async () => {
    const { svc, prisma } = makeService();
    const minted = await svc.mint({
      userId: 'u-1',
      userAgent: SAFARI_MAC,
    });
    expect(minted.cookieValue).toMatch(/^[a-f0-9]{64}$/);
    const stored = prisma._rows()[0];
    expect(stored.deviceHash).toMatch(/^[a-f0-9]{64}$/);
    // sha256(cookieValue) === stored.deviceHash — never store plaintext.
    expect(stored.deviceHash).toBe(TrustedDeviceService.hashCookie(minted.cookieValue));
  });

  it('derives a human-readable label from the User-Agent', async () => {
    const { svc, prisma } = makeService();
    await svc.mint({ userId: 'u-1', userAgent: SAFARI_MAC });
    expect(prisma._rows()[0].label).toBe('Safari on macOS');
  });

  it('falls back to a truncated UA when parse fails', async () => {
    const { svc, prisma } = makeService();
    await svc.mint({
      userId: 'u-1',
      userAgent: 'SomeWeirdAgent/1.0 (no-os-tag)',
    });
    expect(prisma._rows()[0].label).toMatch(/SomeWeirdAgent/);
  });

  it('sets expiresAt ~90 days in the future', async () => {
    const { svc } = makeService();
    const minted = await svc.mint({ userId: 'u-1', userAgent: SAFARI_MAC });
    const ageMs = minted.expiresAt.getTime() - Date.now();
    // 89 days lower bound — accounts for test clock skew.
    expect(ageMs).toBeGreaterThan(89 * 24 * 60 * 60_000);
    expect(ageMs).toBeLessThanOrEqual(90 * 24 * 60 * 60_000);
  });
});

// ─── verify ────────────────────────────────────────────────────────

describe('TrustedDeviceService.verify', () => {
  it('matches a freshly-minted cookie and bumps lastSeenAt', async () => {
    const { svc, prisma } = makeService();
    const { cookieValue } = await svc.mint({
      userId: 'u-1',
      userAgent: CHROME_WIN,
    });
    const before = prisma._rows()[0].lastSeenAt.getTime();
    // Pause briefly so the bumped timestamp is strictly greater.
    await new Promise((r) => setTimeout(r, 5));
    const result = await svc.verify('u-1', cookieValue);
    expect(result).not.toBeNull();
    const after = prisma._rows()[0].lastSeenAt.getTime();
    expect(after).toBeGreaterThan(before);
  });

  it('rejects an unknown cookie value', async () => {
    const { svc } = makeService();
    await svc.mint({ userId: 'u-1', userAgent: CHROME_WIN });
    const result = await svc.verify('u-1', 'wrong-cookie-value');
    expect(result).toBeNull();
  });

  it('rejects when cookie matches a different userId', async () => {
    const { svc } = makeService();
    const { cookieValue } = await svc.mint({
      userId: 'u-1',
      userAgent: CHROME_WIN,
    });
    const result = await svc.verify('u-other', cookieValue);
    expect(result).toBeNull();
  });

  it('rejects an expired row', async () => {
    const expiredHash = TrustedDeviceService.hashCookie('test-cookie');
    const { svc } = makeService([
      {
        id: 'td-x',
        userId: 'u-1',
        deviceHash: expiredHash,
        label: 'old',
        lastSeenAt: new Date(Date.now() - 100 * 86_400_000),
        expiresAt: new Date(Date.now() - 1_000),
      },
    ]);
    const result = await svc.verify('u-1', 'test-cookie');
    expect(result).toBeNull();
  });

  it('treats empty cookie as no match', async () => {
    const { svc } = makeService();
    await svc.mint({ userId: 'u-1', userAgent: CHROME_WIN });
    expect(await svc.verify('u-1', '')).toBeNull();
  });
});

// ─── cap eviction ──────────────────────────────────────────────────

describe('TrustedDeviceService cap', () => {
  it('evicts oldest by lastSeenAt when minting beyond MAX_DEVICES (5)', async () => {
    const { svc, prisma } = makeService();
    // Pre-fill 5 with monotonically-increasing lastSeenAt.
    for (let i = 0; i < 5; i++) {
      await svc.mint({ userId: 'u-1', userAgent: `agent ${i}` });
      // Bump lastSeenAt manually so the oldest is distinguishable.
      prisma._rows()[i].lastSeenAt = new Date(Date.now() + i * 1000);
    }
    // Mint a 6th.
    await svc.mint({ userId: 'u-1', userAgent: 'new agent' });
    // The original first row should now be expired (its expiresAt
    // pulled back to ~now); the next 4 + the new one should still
    // be active (5 total).
    const active = await svc.list('u-1');
    expect(active.length).toBe(5);
    // The oldest one (label 'agent 0') was evicted.
    expect(active.map((r) => r.label)).not.toContain('agent 0');
  });
});

// ─── revoke + revokeAll ────────────────────────────────────────────

describe('TrustedDeviceService.revoke', () => {
  it('pulls expiresAt to now', async () => {
    const { svc, prisma } = makeService();
    const minted = await svc.mint({ userId: 'u-1', userAgent: CHROME_WIN });
    await svc.revoke('u-1', minted.id);
    const row = prisma._rows().find((r) => r.id === minted.id)!;
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 50);
  });

  it('rejects revoking another user\'s device', async () => {
    const { svc } = makeService();
    const minted = await svc.mint({ userId: 'u-1', userAgent: CHROME_WIN });
    await expect(svc.revoke('u-other', minted.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404s on unknown device id', async () => {
    const { svc } = makeService();
    await expect(svc.revoke('u-1', 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('TrustedDeviceService.revokeAll', () => {
  it('counts the rows it expired', async () => {
    const { svc } = makeService();
    await svc.mint({ userId: 'u-1', userAgent: 'a' });
    await svc.mint({ userId: 'u-1', userAgent: 'b' });
    await svc.mint({ userId: 'u-other', userAgent: 'c' });
    const result = await svc.revokeAll('u-1');
    expect(result.revoked).toBe(2);
    // Other user's row untouched.
    expect((await svc.list('u-other')).length).toBe(1);
  });

  it('returns { revoked: 0 } when no active rows exist', async () => {
    const { svc } = makeService();
    expect(await svc.revokeAll('u-empty')).toEqual({ revoked: 0 });
  });
});

// ─── labelFor (pure) ───────────────────────────────────────────────

describe('TrustedDeviceService.labelFor', () => {
  it('Safari on macOS', () => {
    expect(TrustedDeviceService.labelFor(SAFARI_MAC)).toBe('Safari on macOS');
  });
  it('Chrome on Windows', () => {
    expect(TrustedDeviceService.labelFor(CHROME_WIN)).toBe('Chrome on Windows');
  });
  it('Edge on Windows', () => {
    expect(
      TrustedDeviceService.labelFor(
        'Mozilla/5.0 (Windows NT 10.0) Edg/119.0.0.0',
      ),
    ).toBe('Edge on Windows');
  });
  it('Firefox on Linux', () => {
    expect(
      TrustedDeviceService.labelFor(
        'Mozilla/5.0 (X11; Linux x86_64) Firefox/120.0',
      ),
    ).toBe('Firefox on Linux');
  });
  it('falls back to truncated UA when unrecognised', () => {
    expect(TrustedDeviceService.labelFor('CustomBot/1.0')).toBe('CustomBot/1.0');
  });
  it('returns a default for null/empty UA', () => {
    expect(TrustedDeviceService.labelFor(null)).toBe('Unknown device');
    expect(TrustedDeviceService.labelFor('')).toBe('Unknown device');
  });
});
