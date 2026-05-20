import { SettingsService } from './settings.service';
import { SettingType } from '@prisma/client';

/**
 * SettingsService unit tests. Covers:
 *
 *   1. Type-safe accessors return the row value when present.
 *   2. Env-var fallback kicks in when a row is unset.
 *   3. Caller default kicks in when both the row and env-var are absent.
 *   4. Cache warms once and collapses repeated reads.
 *   5. `set()` invalidates the cache.
 *   6. Type mismatch logs + falls back rather than returning a misshapen value.
 */

function makePrismaMock(initial: any = null) {
  let row = initial;
  const findUnique = jest.fn(async () => row);
  const upsert = jest.fn(async ({ create }: any) => {
    row = { ...create, updatedAt: new Date(), createdAt: new Date() };
    return row;
  });
  const historyCreate = jest.fn(async () => ({ id: 'h-1' }));
  return {
    systemSetting: {
      findUnique,
      upsert,
      findMany: jest.fn(async () => (row ? [row] : [])),
    },
    systemSettingHistory: {
      create: historyCreate,
      findMany: jest.fn(async () => []),
    },
    _setRow: (r: any) => {
      row = r;
    },
    _getCalls: () => findUnique.mock.calls.length,
    _getHistoryCalls: () => historyCreate.mock.calls.length,
  };
}

function row(value: unknown, valueType: SettingType) {
  return {
    key: 'wallet.withdraw_min_coins',
    value,
    valueType,
    description: 'Minimum withdrawal',
    updatedBy: null,
    updatedAt: new Date(),
    createdAt: new Date(),
  };
}

describe('SettingsService', () => {
  describe('type-safe accessors', () => {
    it('getInt returns the row value when present', async () => {
      const prisma = makePrismaMock(row(2000, SettingType.INT));
      const svc = new SettingsService(prisma as any);
      expect(await svc.getInt('wallet.withdraw_min_coins', 0)).toBe(2000);
    });

    it('getString returns the row value when present', async () => {
      const prisma = makePrismaMock(row('hello', SettingType.STRING));
      const svc = new SettingsService(prisma as any);
      expect(await svc.getString('wallet.withdraw_min_coins', 'def')).toBe(
        'hello',
      );
    });

    it('getBool returns the row value when present', async () => {
      const prisma = makePrismaMock(row(true, SettingType.BOOL));
      const svc = new SettingsService(prisma as any);
      expect(await svc.getBool('wallet.withdraw_min_coins', false)).toBe(true);
    });

    it('falls back to env var when the row is unset', async () => {
      process.env.WALLET_WITHDRAW_MIN_COINS = '1500';
      try {
        const prisma = makePrismaMock(null);
        const svc = new SettingsService(prisma as any);
        expect(await svc.getInt('wallet.withdraw_min_coins', 100)).toBe(1500);
      } finally {
        delete process.env.WALLET_WITHDRAW_MIN_COINS;
      }
    });

    it('falls back to the caller default when both row and env are unset', async () => {
      const prisma = makePrismaMock(null);
      const svc = new SettingsService(prisma as any);
      expect(await svc.getInt('wallet.withdraw_min_coins', 100)).toBe(100);
    });

    it('logs + falls back when the row has the wrong valueType', async () => {
      // Row was tampered to STRING but caller asks for INT.
      const prisma = makePrismaMock(row('bogus', SettingType.STRING));
      const svc = new SettingsService(prisma as any);
      expect(await svc.getInt('wallet.withdraw_min_coins', 99)).toBe(99);
    });
  });

  describe('cache behaviour', () => {
    it('warms once and collapses subsequent reads', async () => {
      const prisma = makePrismaMock(row(2000, SettingType.INT));
      const svc = new SettingsService(prisma as any);

      await svc.getInt('wallet.withdraw_min_coins', 0);
      await svc.getInt('wallet.withdraw_min_coins', 0);
      await svc.getInt('wallet.withdraw_min_coins', 0);

      expect(prisma._getCalls()).toBe(1);
    });

    it('set() invalidates the cache so the next read sees the new value', async () => {
      const prisma = makePrismaMock(row(2000, SettingType.INT));
      const svc = new SettingsService(prisma as any);

      expect(await svc.getInt('wallet.withdraw_min_coins', 0)).toBe(2000);
      // Admin flips the value via the controller.
      prisma._setRow(row(2500, SettingType.INT));
      await svc.set(
        'wallet.withdraw_min_coins',
        2500,
        SettingType.INT,
        'admin-1',
      );
      expect(await svc.getInt('wallet.withdraw_min_coins', 0)).toBe(2500);
    });

    it('set() writes a SystemSettingHistory entry alongside the upsert', async () => {
      const prisma = makePrismaMock(row(2000, SettingType.INT));
      const svc = new SettingsService(prisma as any);

      await svc.set(
        'wallet.withdraw_min_coins',
        2500,
        SettingType.INT,
        'admin-1',
      );

      expect(prisma._getHistoryCalls()).toBe(1);
    });
  });
});
