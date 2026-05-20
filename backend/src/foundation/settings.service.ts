import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaClient, SettingType } from '@prisma/client';

/**
 * Runtime-settings service. Replaces scattered `process.env.*` reads
 * with a SystemSetting row that admins can edit through the
 * `/admin/settings` UI without a redeploy.
 *
 *   - First lookup: Redis (60s TTL). Hot path: O(1) Redis GET.
 *   - Second lookup: Postgres. On miss, falls back to env-var with
 *     the same name (so existing prod boxes keep working until the
 *     row is seeded).
 *   - Third lookup: the caller's default.
 *
 * Type discipline: every key declares a `valueType` so `getInt(key)`
 * vs `getString(key)` can fail fast if the row was edited to the
 * wrong shape. The admin UI enforces the same discipline at write
 * time.
 *
 * Audit: every write produces a SystemSettingHistory row with the
 * before/after diff plus the actor. Critical settings (wallet caps,
 * KYC tier limits) require two-admin approval — that workflow lives
 * in the admin controller, not here.
 *
 * Skeleton — Foundation PR ships the contract + the Postgres read.
 * Redis caching layer plugs in via a separate `redis.module.ts` in
 * PR-SETTINGS-1.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly prisma: PrismaClient) {}

  async getInt(key: string, fallback: number): Promise<number> {
    const row = await this.findRow(key, SettingType.INT);
    if (row == null) return this.envOr(key, fallback, Number);
    return Number(row.value);
  }

  async getFloat(key: string, fallback: number): Promise<number> {
    const row = await this.findRow(key, SettingType.FLOAT);
    if (row == null) return this.envOr(key, fallback, Number);
    return Number(row.value);
  }

  async getString(key: string, fallback: string): Promise<string> {
    const row = await this.findRow(key, SettingType.STRING);
    if (row == null) return this.envOr(key, fallback, String);
    return String(row.value);
  }

  async getBool(key: string, fallback: boolean): Promise<boolean> {
    const row = await this.findRow(key, SettingType.BOOL);
    if (row == null) return this.envOr(key, fallback, (v) => v === 'true' || v === '1');
    return Boolean(row.value);
  }

  async getJson<T>(key: string, fallback: T): Promise<T> {
    const row = await this.findRow(key, SettingType.JSON);
    if (row == null) return fallback;
    return row.value as T;
  }

  /**
   * Admin write. Caller must:
   *   1. Pass `actorId` (used both for SystemSetting.updatedBy and
   *      the SystemSettingHistory entry).
   *   2. Validate the new `value` against the expected `valueType`
   *      at the controller layer.
   *   3. Have already verified the actor's permission to edit this
   *      key (some settings are admin-only, some require two-admin
   *      approval — the controller decides).
   */
  async set(
    key: string,
    value: unknown,
    valueType: SettingType,
    actorId: string,
    description?: string,
  ) {
    const before = await this.prisma.systemSetting.findUnique({ where: { key } });

    const updated = await this.prisma.systemSetting.upsert({
      where: { key },
      update: {
        value: value as object,
        valueType,
        description: description ?? before?.description ?? null,
        updatedBy: actorId,
      },
      create: {
        key,
        value: value as object,
        valueType,
        description: description ?? null,
        updatedBy: actorId,
      },
    });

    await this.prisma.systemSettingHistory.create({
      data: {
        key,
        before: before?.value ?? undefined,
        after: value as object,
        changedBy: actorId,
      },
    });

    // TODO (PR-SETTINGS-1): invalidate Redis cache for this key.
    return updated;
  }

  private async findRow(key: string, expectedType: SettingType) {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (!row) return null;
    if (row.valueType !== expectedType) {
      this.logger.warn(
        `setting ${key} declared as ${row.valueType} but reader expected ${expectedType}`,
      );
      return null;
    }
    return row;
  }

  private envOr<T>(key: string, fallback: T, coerce: (s: string) => T): T {
    // Translate dotted setting key (`wallet.withdraw_min_coins`) to
    // SHOUTING_SNAKE env-var convention (`WALLET_WITHDRAW_MIN_COINS`).
    const envKey = key.replace(/\./g, '_').toUpperCase();
    const v = process.env[envKey];
    if (v == null || v === '') return fallback;
    return coerce(v);
  }
}
