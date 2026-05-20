import { FeatureFlagService } from './feature-flags.service';
import { FlagMode, Role } from '@prisma/client';

/**
 * FeatureFlagService unit tests. Covers:
 *
 *   1. The three flag modes (BOOLEAN, ROLE, PERCENT) resolve correctly.
 *   2. The cache layer collapses repeated reads to a single Postgres
 *      hit (the main performance assertion).
 *   3. `setFlag` invalidates the cache so the next read sees fresh.
 *   4. PERCENT is a stable hash (same user → same bucket).
 */

function makeFlag(overrides: Partial<any> = {}) {
  return {
    id: 'test.flag',
    description: '',
    mode: FlagMode.BOOLEAN,
    enabled: false,
    roles: [],
    rolloutPercent: 0,
    updatedBy: null,
    updatedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

function makePrismaMock(initial: any = null) {
  let row = initial;
  const findUnique = jest.fn(async () => row);
  const update = jest.fn(async ({ data }: any) => {
    row = { ...row, ...data };
    return row;
  });
  return {
    findUnique,
    update,
    findMany: jest.fn(async () => (row ? [row] : [])),
    _setRow: (r: any) => {
      row = r;
    },
    _getCalls: () => findUnique.mock.calls.length,
  };
}

function makeService(prismaMock: any): FeatureFlagService {
  return new FeatureFlagService({ featureFlag: prismaMock } as any);
}

describe('FeatureFlagService', () => {
  describe('mode resolution', () => {
    it('returns false for missing flags', async () => {
      const prisma = makePrismaMock(null);
      const svc = makeService(prisma);
      expect(await svc.isEnabled('missing')).toBe(false);
    });

    it('BOOLEAN: returns the enabled flag value', async () => {
      const prisma = makePrismaMock(makeFlag({ enabled: true }));
      const svc = makeService(prisma);
      expect(await svc.isEnabled('test.flag')).toBe(true);
    });

    it('ROLE: denies users with no roles, allows users with a matching role', async () => {
      const prisma = makePrismaMock(
        makeFlag({ mode: FlagMode.ROLE, roles: [Role.MODERATOR, Role.ADMIN] }),
      );
      const svc = makeService(prisma);
      expect(await svc.isEnabled('test.flag', { id: 'u1' })).toBe(false);
      expect(
        await svc.isEnabled('test.flag', { id: 'u1', roles: [Role.SUPPORT] }),
      ).toBe(false);
      expect(
        await svc.isEnabled('test.flag', { id: 'u1', roles: [Role.MODERATOR] }),
      ).toBe(true);
    });

    it('ROLE: returns false when no user is supplied (anonymous gating)', async () => {
      const prisma = makePrismaMock(
        makeFlag({ mode: FlagMode.ROLE, roles: [Role.ADMIN] }),
      );
      const svc = makeService(prisma);
      expect(await svc.isEnabled('test.flag')).toBe(false);
    });

    it('PERCENT: same user always lands in the same bucket', async () => {
      const prisma = makePrismaMock(
        makeFlag({ mode: FlagMode.PERCENT, rolloutPercent: 50 }),
      );
      const svc = makeService(prisma);
      const a = await svc.isEnabled('test.flag', { id: 'user-x' });
      const b = await svc.isEnabled('test.flag', { id: 'user-x' });
      expect(a).toBe(b);
    });

    it('PERCENT: 100% always enabled, 0% never enabled', async () => {
      const prismaAll = makePrismaMock(
        makeFlag({ mode: FlagMode.PERCENT, rolloutPercent: 100 }),
      );
      const prismaNone = makePrismaMock(
        makeFlag({ mode: FlagMode.PERCENT, rolloutPercent: 0 }),
      );
      expect(
        await makeService(prismaAll).isEnabled('test.flag', { id: 'u1' }),
      ).toBe(true);
      expect(
        await makeService(prismaNone).isEnabled('test.flag', { id: 'u1' }),
      ).toBe(false);
    });
  });

  describe('cache behaviour', () => {
    it('warms the cache and collapses subsequent reads to zero Postgres hits', async () => {
      const prisma = makePrismaMock(makeFlag({ enabled: true }));
      const svc = makeService(prisma);

      await svc.isEnabled('test.flag');
      await svc.isEnabled('test.flag');
      await svc.isEnabled('test.flag');

      expect(prisma._getCalls()).toBe(1);
    });

    it('caches the null sentinel so a missing flag is also a single hit', async () => {
      const prisma = makePrismaMock(null);
      const svc = makeService(prisma);

      expect(await svc.isEnabled('missing')).toBe(false);
      expect(await svc.isEnabled('missing')).toBe(false);
      expect(prisma._getCalls()).toBe(1);
    });

    it('setFlag() invalidates the cache so the next read sees the new value', async () => {
      const prisma = makePrismaMock(makeFlag({ enabled: false }));
      const svc = makeService(prisma);

      expect(await svc.isEnabled('test.flag')).toBe(false);
      // Simulate the row flipping under us (admin clicked the toggle).
      await svc.setFlag('test.flag', { enabled: true }, 'admin-1');
      expect(await svc.isEnabled('test.flag')).toBe(true);
      // 2 reads through the service: 1st warmed cache, 2nd was the
      // post-invalidate refetch. Plus the update inside setFlag.
      expect(prisma._getCalls()).toBe(2);
    });
  });
});
