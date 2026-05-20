import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SettingType, SystemSetting } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TtlCache } from './ttl-cache';

/**
 * Runtime-settings service. Replaces scattered `process.env.*` reads
 * with a `SystemSetting` row that admins can edit through the
 * `/admin/settings` UI without a redeploy.
 *
 *   - First lookup: in-process cache (60s TTL). Hot path: O(1) Map GET.
 *   - Second lookup: Postgres. On miss, falls back to env-var with
 *     the same name (so existing prod boxes keep working until the
 *     row is seeded).
 *   - Third lookup: the caller's default.
 *
 * Cache invalidation is local on `set()`. Cross-pod propagation is
 * deferred to the Redis swap — until then the design accepts <60s
 * staleness on other pods, which matches the original "Redis with
 * TTL, no PUBSUB" SLA.
 *
 * Type discipline: every key declares a `valueType` so `getInt(key)`
 * vs `getString(key)` can fail fast if the row was edited to the
 * wrong shape. The admin UI enforces the same discipline at write
 * time.
 *
 * Audit: every write produces a SystemSettingHistory row with the
 * before/after diff plus the actor. Critical settings (wallet caps,
 * KYC tier limits) carry a two-admin-approval flag — that workflow
 * lives in the admin controller, not here.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private static readonly TTL_MS = 60_000;
  private readonly cache = new TtlCache<SystemSetting | null>(
    SettingsService.TTL_MS,
  );

  constructor(private readonly prisma: PrismaService) {}

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
    if (row == null)
      return this.envOr(key, fallback, (v) => v === 'true' || v === '1');
    return Boolean(row.value);
  }

  async getJson<T>(key: string, fallback: T): Promise<T> {
    const row = await this.findRow(key, SettingType.JSON);
    if (row == null) return fallback;
    return row.value as T;
  }

  /**
   * List every catalog row. Admin UI uses this to populate the
   * grouped editor. Bypasses cache because admin reads are not
   * hot-path and need to reflect any other admin's recent edit.
   */
  async list(): Promise<SystemSetting[]> {
    return this.prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
  }

  /**
   * Last N history rows for a given key — drives the "previous
   * values" side panel in the admin UI.
   */
  async history(key: string, limit = 50) {
    return this.prisma.systemSettingHistory.findMany({
      where: { key },
      orderBy: { changedAt: 'desc' },
      take: Math.max(1, Math.min(200, limit)),
    });
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
  ): Promise<SystemSetting> {
    const before = await this.prisma.systemSetting.findUnique({
      where: { key },
    });

    const updated = await this.prisma.systemSetting.upsert({
      where: { key },
      update: {
        value: value as Prisma.InputJsonValue,
        valueType,
        description: description ?? before?.description ?? null,
        updatedBy: actorId,
      },
      create: {
        key,
        value: value as Prisma.InputJsonValue,
        valueType,
        description: description ?? null,
        updatedBy: actorId,
      },
    });

    await this.prisma.systemSettingHistory.create({
      data: {
        key,
        before: (before?.value ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        after: value as Prisma.InputJsonValue,
        changedBy: actorId,
      },
    });

    // Local invalidation — cross-pod will pick up the new value
    // when their own TTL expires (≤ 60s).
    this.cache.invalidate(key);
    return updated;
  }

  /**
   * Hot-path read. Cache HIT → typed value. MISS → Postgres → cache
   * PUT. Also caches the null outcome so an unseeded key isn't a
   * Postgres roundtrip every call.
   */
  private async findRow(
    key: string,
    expectedType: SettingType,
  ): Promise<SystemSetting | null> {
    const cached = this.cache.get(key);
    let row: SystemSetting | null;
    if (cached !== undefined) {
      row = cached;
    } else {
      row = await this.prisma.systemSetting.findUnique({ where: { key } });
      this.cache.set(key, row);
    }

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
