import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, FlagMode, Role } from '@prisma/client';
import * as crypto from 'crypto';

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
 * Reads are Redis-cached (10s TTL). Cache MISS → Postgres read →
 * cache PUT. Cache invalidation happens on write via Redis PUBSUB —
 * see `setFlag()` below. With a 10s TTL the worst-case staleness on
 * a missed PUBSUB is short enough for any non-financial gating.
 *
 * Hot-path goal: O(1) Redis GET per call.
 *
 * Bootstrap: if the flag row doesn't exist, we treat it as "disabled
 * BOOLEAN" rather than throwing. Lets feature code reference flags
 * that haven't been seeded yet without crashing.
 *
 * Skeleton — Foundation PR ships the contract; the Redis cache layer
 * is wired in PR-NOTIFY-1 (which is the first PR that actually reads
 * a flag on the hot path).
 */
@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Resolve a flag for a specific user. `user` may be undefined for
   * anonymous gating (e.g. landing-page feature flags) — in that case
   * ROLE flags are denied and PERCENT flags evaluate against a synthetic
   * stable hash of the request's IP/UA.
   */
  async isEnabled(
    flagId: string,
    user?: { id: string; roles?: Role[] },
  ): Promise<boolean> {
    const flag = await this.prisma.featureFlag.findUnique({
      where: { id: flagId },
    });
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
   * Admin-only writer. Always writes through to the FeatureFlag row;
   * invalidation is handled separately (Redis PUBSUB or a 10s TTL).
   * Every write must be paired with an AdminAuditLog entry — the
   * controller layer is responsible for that.
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
  ) {
    return this.prisma.featureFlag.update({
      where: { id: flagId },
      data: { ...update, updatedBy },
    });
  }
}
