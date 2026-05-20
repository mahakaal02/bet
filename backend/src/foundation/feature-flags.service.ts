import { Injectable, Logger } from '@nestjs/common';
import { FeatureFlag, FlagMode, Role } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TtlCache } from './ttl-cache';

/**
 * Feature-flag evaluator. Three modes:
 *
 *   BOOLEAN  — `enabled` is the answer.
 *   ROLE     — enabled iff the user holds any role in `roles`.
 *   PERCENT  — enabled iff hash(userId + flagId) % 100 < rolloutPercent.
 *              Deterministic per (user, flag) so the same user always sees
 *              the same answer across requests, but different flags can
 *              hit different cohorts.
 *
 * Reads are cached (10s TTL). Cache MISS → Postgres read → cache PUT.
 * Writes invalidate the local entry; cross-pod invalidation is
 * deferred to the Redis swap (see `ttl-cache.ts` rationale).
 *
 * Hot-path goal: O(1) Map GET per call once warm.
 *
 * Bootstrap: if the flag row doesn't exist, we treat it as "disabled
 * BOOLEAN" rather than throwing. Lets feature code reference flags
 * that haven't been seeded yet without crashing. The `null` outcome
 * is also cached (negative cache) so a missing flag isn't a hot-path
 * Postgres hit every request.
 */
@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);
  private static readonly TTL_MS = 10_000;
  private readonly cache = new TtlCache<FeatureFlag | null>(
    FeatureFlagService.TTL_MS,
  );

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve a flag for a specific user. `user` may be undefined for
   * anonymous gating (e.g. landing-page feature flags) — in that case
   * ROLE flags are denied and PERCENT flags evaluate to false (no
   * stable identity to bucket against).
   */
  async isEnabled(
    flagId: string,
    user?: { id: string; roles?: Role[] },
  ): Promise<boolean> {
    const flag = await this.lookup(flagId);
    if (!flag) return false;

    switch (flag.mode) {
      case FlagMode.BOOLEAN:
        return flag.enabled;
      case FlagMode.ROLE:
        if (!user || !user.roles?.length) return false;
        return user.roles.some((r) => flag.roles.includes(r));
      case FlagMode.PERCENT: {
        if (!user) return false;
        // Stable hash → 0..99 bucket. Same user + same flag always
        // lands in the same bucket, so a 5% rollout is a stable 5%.
        const h = crypto
          .createHash('sha1')
          .update(`${user.id}:${flagId}`)
          .digest();
        const bucket = h[0] % 100;
        return bucket < flag.rolloutPercent;
      }
      default:
        this.logger.warn(`unknown flag mode ${flag.mode} for ${flagId}`);
        return false;
    }
  }

  /**
   * Return the raw flag row (or null). Useful for the admin UI to
   * render the full state. Bypasses cache to always show the latest
   * — admin reads are not hot-path.
   */
  async getFlag(flagId: string): Promise<FeatureFlag | null> {
    return this.prisma.featureFlag.findUnique({ where: { id: flagId } });
  }

  async listFlags(): Promise<FeatureFlag[]> {
    return this.prisma.featureFlag.findMany({ orderBy: { id: 'asc' } });
  }

  /**
   * Admin writer. Updates the row and invalidates the local cache.
   * The controller layer is responsible for the AdminAuditLog entry —
   * keeping the service free of HTTP-shaped concerns (actor id,
   * IP, etc.) makes it easier to unit-test.
   */
  async setFlag(
    flagId: string,
    update: Partial<{
      description: string;
      mode: FlagMode;
      enabled: boolean;
      roles: Role[];
      rolloutPercent: number;
    }>,
    updatedBy: string,
  ): Promise<FeatureFlag> {
    const updated = await this.prisma.featureFlag.update({
      where: { id: flagId },
      data: { ...update, updatedBy },
    });
    this.cache.invalidate(flagId);
    return updated;
  }

  /**
   * Hot-path lookup. Cache HIT → return value. MISS → Postgres
   * read → cache PUT (including the null outcome). Keeps the
   * Postgres roundtrip cost amortised across the TTL window.
   */
  private async lookup(flagId: string): Promise<FeatureFlag | null> {
    const cached = this.cache.get(flagId);
    if (cached !== undefined) return cached;
    const row = await this.prisma.featureFlag.findUnique({
      where: { id: flagId },
    });
    this.cache.set(flagId, row ?? null);
    return row ?? null;
  }
}
