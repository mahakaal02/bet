import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  NotificationChannel,
  Prisma,
  RgEventKind,
  type ResponsibleGamblingProfile,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../foundation/notification.service';

/**
 * Responsible-gambling controls — Roadmap §F-USER-14.
 *
 * This PR (PR-RG-1) ships the user-facing settings surface plus
 * enforcement on the bid-placement path. Aviator pre-bet hook +
 * session-reminder WebSocket land in PR-RG-2.
 *
 * Lower-instant / raise-deferred:
 *   - DECREASING a limit (or setting one for the first time) takes
 *     effect immediately. The whole point of RG is to give the user
 *     friction-free brakes.
 *   - INCREASING a limit is regulatory-sensitive and intentionally
 *     refused here. The roadmap calls for a 24h cool-off; until the
 *     schema gains a `pendingValue` column (PR-RG-2), we tell the
 *     user to contact support. Friendly + safe.
 *   - REMOVING a limit (setting to null) is treated as raising — same
 *     refusal path.
 *
 * Cooldown vs self-exclusion:
 *   - Both block login + betting.
 *   - Cooldown is shorter (24h, 7d, 30d, 90d), self-cancellable
 *     after expiry. Cool-down is voluntary, NOT regulatory.
 *   - Self-exclusion is the regulatory tool. 7d / 30d / 90d / permanent.
 *     Permanent is `selfExcludedAt` set, `selfExcludedUntil = null`.
 *     Either way, the user cannot shorten the period — only support
 *     can, and only after the time has passed.
 *
 * Wager-limit math (auctions side):
 *   - For each bid: cost = `Auction.coinsPerBid`.
 *   - Daily wager = SUM(coinsPerBid) across the user's bids since
 *     UTC midnight. Aggregated in JS to keep the query simple; at
 *     the per-user scale (≤ thousands of bids/day) this is fine.
 *
 * Every limit change + every block writes a `ResponsibleGamblingEvent`
 * row so admins (and the user themselves) have a forensic trail.
 *
 * `rg_*` notification templates bypass the user's marketing opt-outs
 * by design — the `NotificationService` regulatory carve-out (see
 * `notification.service.ts`) lets them through.
 */

const COOLDOWN_DURATIONS = {
  day1: 24 * 60 * 60_000,
  day7: 7 * 24 * 60 * 60_000,
  day30: 30 * 24 * 60 * 60_000,
  day90: 90 * 24 * 60 * 60_000,
} as const;
type CooldownDuration = keyof typeof COOLDOWN_DURATIONS;

const SELF_EXCLUSION_DURATIONS = {
  day7: 7 * 24 * 60 * 60_000,
  day30: 30 * 24 * 60 * 60_000,
  day90: 90 * 24 * 60 * 60_000,
  permanent: null,                                      // sentinel
} as const;
type SelfExclusionDuration = keyof typeof SELF_EXCLUSION_DURATIONS;

export interface UpdateLimitsDto {
  dailyDepositLimitCoins?: number | null;
  weeklyDepositLimitCoins?: number | null;
  monthlyDepositLimitCoins?: number | null;
  dailyLossLimitCoins?: number | null;
  weeklyLossLimitCoins?: number | null;
  monthlyLossLimitCoins?: number | null;
  dailyWagerLimitCoins?: number | null;
  sessionReminderMinutes?: number;
}

const LIMIT_FIELDS = [
  'dailyDepositLimitCoins',
  'weeklyDepositLimitCoins',
  'monthlyDepositLimitCoins',
  'dailyLossLimitCoins',
  'weeklyLossLimitCoins',
  'monthlyLossLimitCoins',
  'dailyWagerLimitCoins',
] as const;
type LimitField = (typeof LIMIT_FIELDS)[number];

/** 24h cool-off for limit RAISES (PR-RG-2). */
const RAISE_COOLOFF_MS = 24 * 60 * 60_000;

/**
 * If a session has been idle for > IDLE_RESET_MS we treat the next
 * ping as a fresh session — the reminder counter restarts. Otherwise
 * a user who closes the laptop overnight would get "you've played
 * for 17 hours" the moment they reopen it.
 */
const IDLE_RESET_MS = 30 * 60_000;

@Injectable()
export class ResponsibleGamblingService {
  private readonly logger = new Logger(ResponsibleGamblingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Read-only profile. Lazily creates an empty row on first access
   * so the UI never gets a 404 + the user can immediately PATCH
   * limits onto a known row. Also opportunistically promotes any
   * pending raise that's now due (lazy scheduler — avoids needing
   * a separate cron job).
   */
  async getProfile(userId: string): Promise<ResponsibleGamblingProfile> {
    const profile = await this.prisma.responsibleGamblingProfile.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
    if (profile.pendingActivatesAt && profile.pendingActivatesAt.getTime() <= Date.now()) {
      // The applyPendingIfDue() call reads + writes the row again. It
      // would be cheaper to inline that work here, but separating
      // them keeps the "promote pending" logic in one place where
      // tests can exercise it directly.
      const promoted = await this.applyPendingIfDue(userId);
      if (promoted) return promoted;
    }
    return profile;
  }

  /**
   * Update one or more limit fields.
   *
   *   - Lower / set-for-first-time: applied INSTANTLY.
   *   - Raise / remove (loosening): staged into `pendingLimits` with
   *     a 24h activation window. User can cancel via
   *     `cancelPendingRaise()` before the window closes; the cron
   *     (or any read of the profile after activation) promotes the
   *     pending bag onto the live columns.
   *
   * Lower + raise in the same PATCH apply differently: the lowers go
   * in immediately, the raises stage in pendingLimits.
   *
   * Returns the updated profile (with `pendingLimits` populated when
   * raises are staged so the UI can show "scheduled for X").
   */
  async updateLimits(
    userId: string,
    dto: UpdateLimitsDto,
  ): Promise<ResponsibleGamblingProfile> {
    const current = await this.getProfile(userId);

    const changes: Partial<UpdateLimitsDto> = {};
    const stagedRaises: Partial<Record<LimitField, number | null>> = {};
    for (const field of LIMIT_FIELDS) {
      if (!(field in dto)) continue;
      const before = current[field] as number | null;
      const after = dto[field];
      if (after === undefined) continue;

      // Validate the raw value before comparing.
      if (after !== null) {
        if (!Number.isInteger(after) || after < 0) {
          throw new BadRequestException(`${field} must be a non-negative integer`);
        }
      }

      const isLower =
        // Setting a limit for the first time → counts as lower.
        before === null && after !== null
          ? true
          // Removing a limit → counts as raise (loosening).
          : before !== null && after === null
            ? false
            // Both numbers → strict comparison.
            : (after as number) < (before as number);

      if (after === before) continue;                   // no-op
      if (!isLower) {
        stagedRaises[field] = after;
        continue;
      }
      changes[field] = after;
    }

    // Session reminder is non-financial — allow either direction.
    if (typeof dto.sessionReminderMinutes === 'number') {
      if (
        !Number.isInteger(dto.sessionReminderMinutes) ||
        dto.sessionReminderMinutes < 5 ||
        dto.sessionReminderMinutes > 720
      ) {
        throw new BadRequestException(
          'sessionReminderMinutes must be an integer between 5 and 720',
        );
      }
      changes.sessionReminderMinutes = dto.sessionReminderMinutes;
    }

    const hasRaises = Object.keys(stagedRaises).length > 0;
    if (Object.keys(changes).length === 0 && !hasRaises) {
      return current;
    }

    const data: Record<string, unknown> = { ...changes };
    if (hasRaises) {
      // Merge new pending raises into any pre-existing pending set —
      // last-write-wins per field. Re-arm the 24h timer on every new
      // raise so the user can't pile up changes during the window.
      const existing = (current.pendingLimits as Record<string, number | null> | null) ?? {};
      data.pendingLimits = { ...existing, ...stagedRaises };
      data.pendingActivatesAt = new Date(Date.now() + RAISE_COOLOFF_MS);
    }

    const updated = await this.prisma.responsibleGamblingProfile.update({
      where: { userId },
      data,
    });

    // Forensic trail: one event row per field that actually changed,
    // so the admin audit lens shows "which knob got tightened when".
    await this.prisma.responsibleGamblingEvent.createMany({
      data: Object.entries(changes)
        .filter(([k]) => k !== 'sessionReminderMinutes')
        .map(([k, v]) => ({
          userId,
          kind: RgEventKind.COOLDOWN_STARTED,            // closest enum
          limitKind: k,
          limitValue: v as number | null,
        })),
    });

    // One notification per save (not per field) — avoid spamming.
    if (Object.keys(changes).length > 0) {
      await this.notifications.enqueue({
        templateCode: 'rg_limit_changed_v1',
        userId,
        payload: {
          username: '',                                    // template doesn't need it
          changes: Object.keys(changes).join(', '),
        },
        idempotencyAnchor: `rg_limit_changed:${userId}:${Date.now()}`,
        channels: [
          NotificationChannel.EMAIL,
          NotificationChannel.INAPP,
        ],
      });
    }

    if (hasRaises) {
      await this.notifications.enqueue({
        templateCode: 'rg_pending_raise_v1',
        userId,
        payload: {
          username: '',
          activatesAt: (data.pendingActivatesAt as Date).toISOString(),
        },
        idempotencyAnchor: `rg_pending_raise:${userId}:${(data.pendingActivatesAt as Date).getTime()}`,
        channels: [NotificationChannel.EMAIL, NotificationChannel.INAPP],
      });
    }

    return updated;
  }

  /**
   * Cancel any pending limit raises. The 24h cool-off exists precisely
   * for this: the user clicks "Actually, leave my limits alone" and
   * we drop the staged values.
   *
   * No notification on cancel — it's a non-event from a compliance
   * angle. Forensic event row still written so admin audit shows the
   * cancellation.
   */
  async cancelPendingRaise(userId: string): Promise<ResponsibleGamblingProfile> {
    const profile = await this.getProfile(userId);
    if (!profile.pendingLimits && !profile.pendingActivatesAt) {
      return profile;
    }
    const updated = await this.prisma.responsibleGamblingProfile.update({
      where: { userId },
      data: { pendingLimits: Prisma.JsonNull, pendingActivatesAt: null },
    });
    await this.prisma.responsibleGamblingEvent.create({
      data: {
        userId,
        kind: RgEventKind.COOLDOWN_ENDED,                  // closest enum — pending raise cancelled
        limitKind: 'pending_raise_cancelled',
        limitValue: null,
      },
    });
    return updated;
  }

  /**
   * Promote pending raises to live values if the activate window has
   * passed. Idempotent — calling on an unset profile is a no-op.
   *
   * Two callers:
   *   1. The session-ping endpoint (cheap; runs on every heartbeat).
   *   2. `getProfile()` (so the UI reflects the new values without
   *      waiting for a scheduled job).
   *
   * No notification fires on activation — the user already knew this
   * was coming when they staged the raise.
   */
  async applyPendingIfDue(
    userId: string,
  ): Promise<ResponsibleGamblingProfile | null> {
    const profile = await this.prisma.responsibleGamblingProfile.findUnique({
      where: { userId },
    });
    if (!profile) return null;
    if (
      !profile.pendingActivatesAt ||
      profile.pendingActivatesAt.getTime() > Date.now() ||
      !profile.pendingLimits
    ) {
      return profile;
    }
    const staged = profile.pendingLimits as Record<string, number | null>;
    const applyData: Record<string, unknown> = {
      pendingLimits: Prisma.JsonNull,
      pendingActivatesAt: null,
    };
    for (const field of LIMIT_FIELDS) {
      if (field in staged) {
        applyData[field] = staged[field];
      }
    }
    const updated = await this.prisma.responsibleGamblingProfile.update({
      where: { userId },
      data: applyData,
    });
    await this.prisma.responsibleGamblingEvent.createMany({
      data: Object.entries(staged).map(([k, v]) => ({
        userId,
        kind: RgEventKind.COOLDOWN_ENDED,                 // closest enum — pending raise applied
        limitKind: `pending_raise_applied:${k}`,
        limitValue: v,
      })),
    });
    return updated;
  }

  /**
   * Session-reminder heartbeat. Client-side calls this on a 60s
   * timer while the user is active. Server:
   *
   *   1. If the last ping was > IDLE_RESET_MS ago, treat this as a
   *      fresh session — reset `sessionStartedAt`.
   *   2. Otherwise compute the elapsed-since-start.
   *   3. If elapsed >= `sessionReminderMinutes` AND we haven't fired
   *      a reminder this session, return `reminderDue: true` and
   *      push an INAPP notification.
   *
   * Returns `{ reminderDue, minutesElapsed, sessionStartedAt }`.
   * `reminderDue` debounces — once fired in a given session it stays
   * false until the next idle gap resets the timer.
   */
  async recordSessionPing(userId: string): Promise<{
    reminderDue: boolean;
    minutesElapsed: number;
    sessionStartedAt: Date;
  }> {
    // Apply any pending raise that's now eligible — keeps the
    // session ping doing double duty as the "scheduler".
    await this.applyPendingIfDue(userId);

    const profile = await this.getProfile(userId);
    const now = new Date();

    const idleSinceLastPing = profile.lastSessionPingAt
      ? now.getTime() - profile.lastSessionPingAt.getTime()
      : Number.MAX_SAFE_INTEGER;
    const isFreshSession =
      !profile.sessionStartedAt || idleSinceLastPing > IDLE_RESET_MS;

    const sessionStartedAt = isFreshSession ? now : profile.sessionStartedAt!;
    const elapsedMs = now.getTime() - sessionStartedAt.getTime();
    const minutesElapsed = Math.floor(elapsedMs / 60_000);

    const thresholdMs = profile.sessionReminderMinutes * 60_000;
    const reminderAlreadyFired =
      profile.lastReminderAt !== null &&
      profile.lastReminderAt.getTime() >= sessionStartedAt.getTime();
    const reminderDue = !reminderAlreadyFired && elapsedMs >= thresholdMs;

    await this.prisma.responsibleGamblingProfile.update({
      where: { userId },
      data: {
        sessionStartedAt,
        lastSessionPingAt: now,
        ...(reminderDue ? { lastReminderAt: now } : {}),
      },
    });

    if (reminderDue) {
      await this.prisma.responsibleGamblingEvent.create({
        data: {
          userId,
          kind: RgEventKind.SESSION_REMINDER_SHOWN,
          sessionDurationMs: elapsedMs,
        },
      });
      // Fire-and-forget; the INAPP gateway pushes to the user's
      // socket room (see notifications/notification-broadcast.gateway.ts).
      await this.notifications.enqueue({
        templateCode: 'rg_session_reminder_v1',
        userId,
        payload: { minutes: String(minutesElapsed) },
        idempotencyAnchor: `rg_session_reminder:${userId}:${sessionStartedAt.getTime()}`,
        channels: [NotificationChannel.INAPP],
      });
    }

    return { reminderDue, minutesElapsed, sessionStartedAt };
  }

  /**
   * Aviator pre-bet hook. Wraps `assertCanBet` (the auctions-side
   * gate) with a session ping so the reminder timer keeps counting
   * even when the user is purely in Aviator. Aviator's bet route
   * calls this directly; bid route still uses `assertCanBet` since
   * its own gate doesn't need a heartbeat.
   */
  async assertCanWager(userId: string, coinsToWager: number): Promise<void> {
    await this.assertCanBet(userId, coinsToWager);
    // Don't await the ping — if it fails, the user shouldn't lose
    // the bet. But we still want the timer to advance.
    void this.recordSessionPing(userId).catch((err) => {
      this.logger.warn(
        `session ping failed for ${userId}: ${(err as Error).message}`,
      );
    });
  }

  async startCooldown(userId: string, duration: CooldownDuration) {
    const ms = COOLDOWN_DURATIONS[duration];
    if (!ms) throw new BadRequestException('unknown cooldown duration');

    const profile = await this.getProfile(userId);
    if (profile.cooldownUntil && profile.cooldownUntil.getTime() > Date.now()) {
      throw new BadRequestException('cool-down already in effect');
    }

    const until = new Date(Date.now() + ms);
    const updated = await this.prisma.responsibleGamblingProfile.update({
      where: { userId },
      data: { cooldownUntil: until },
    });
    await this.prisma.responsibleGamblingEvent.create({
      data: {
        userId,
        kind: RgEventKind.COOLDOWN_STARTED,
        limitKind: 'cooldown',
        limitValue: ms / 60_000,
      },
    });
    await this.notifications.enqueue({
      templateCode: 'rg_cooldown_started_v1',
      userId,
      payload: {
        durationLabel: humanDuration(ms),
        endsAt: until.toISOString(),
      },
      idempotencyAnchor: `rg_cooldown:${userId}:${until.getTime()}`,
      channels: [NotificationChannel.EMAIL, NotificationChannel.INAPP],
    });
    return updated;
  }

  async startSelfExclusion(
    userId: string,
    duration: SelfExclusionDuration,
  ) {
    const ms = SELF_EXCLUSION_DURATIONS[duration];
    if (ms === undefined) {
      throw new BadRequestException('unknown self-exclusion duration');
    }
    const now = new Date();
    const until = ms === null ? null : new Date(now.getTime() + ms);

    const profile = await this.getProfile(userId);
    if (profile.selfExcludedAt) {
      throw new BadRequestException(
        'already self-excluded — contact support if you need to extend or reduce the period',
      );
    }

    const updated = await this.prisma.responsibleGamblingProfile.update({
      where: { userId },
      data: { selfExcludedAt: now, selfExcludedUntil: until },
    });
    await this.prisma.responsibleGamblingEvent.create({
      data: {
        userId,
        kind: RgEventKind.SELF_EXCLUSION_STARTED,
        limitKind: 'self_exclusion',
        limitValue: ms === null ? null : ms / 60_000,
      },
    });
    await this.notifications.enqueue({
      templateCode: 'rg_self_excluded_v1',
      userId,
      payload: {
        durationLabel: ms === null ? 'permanent' : humanDuration(ms),
        endsAt: until?.toISOString() ?? null,
      },
      idempotencyAnchor: `rg_self_excluded:${userId}:${now.getTime()}`,
      channels: [NotificationChannel.EMAIL, NotificationChannel.INAPP],
    });
    return updated;
  }

  /**
   * Auth-time gate. Throws ForbiddenException if the user is in a
   * cooldown or self-exclusion period. Called from AuthService.login
   * (post-password) and AuthService.validateJwt (every authed request).
   */
  async assertCanLogin(userId: string): Promise<void> {
    const profile = await this.prisma.responsibleGamblingProfile.findUnique({
      where: { userId },
    });
    if (!profile) return;
    const now = Date.now();

    // Self-exclusion permanent has selfExcludedAt set, selfExcludedUntil = null.
    if (profile.selfExcludedAt) {
      if (
        profile.selfExcludedUntil === null ||
        profile.selfExcludedUntil.getTime() > now
      ) {
        throw new ForbiddenException(
          profile.selfExcludedUntil
            ? `Self-excluded until ${profile.selfExcludedUntil.toISOString()}`
            : 'Permanently self-excluded — contact support for help.',
        );
      }
    }

    if (profile.cooldownUntil && profile.cooldownUntil.getTime() > now) {
      throw new ForbiddenException(
        `Cool-down active until ${profile.cooldownUntil.toISOString()}`,
      );
    }
  }

  /**
   * Bid-placement gate. Called from BidsService BEFORE the
   * `Bid.create` runs. Sums all bid costs since UTC midnight, adds
   * `coinsPerBid`, and rejects if that crosses `dailyWagerLimitCoins`.
   * Also rejects on cooldown / self-exclusion as a defence in depth
   * (the auth path should already have caught those, but the bid
   * route trusts the JWT subject).
   */
  async assertCanBet(
    userId: string,
    coinsToWager: number,
  ): Promise<void> {
    const profile = await this.prisma.responsibleGamblingProfile.findUnique({
      where: { userId },
    });
    if (!profile) return;

    const now = Date.now();
    if (profile.selfExcludedAt) {
      if (
        profile.selfExcludedUntil === null ||
        profile.selfExcludedUntil.getTime() > now
      ) {
        await this.recordBetBlock(userId, 'self_exclusion', null, coinsToWager);
        throw new ForbiddenException('Self-excluded — bidding is disabled.');
      }
    }
    if (profile.cooldownUntil && profile.cooldownUntil.getTime() > now) {
      await this.recordBetBlock(userId, 'cooldown', null, coinsToWager);
      throw new ForbiddenException(
        `Cool-down active until ${profile.cooldownUntil.toISOString()}`,
      );
    }

    if (profile.dailyWagerLimitCoins == null) return;

    const todayStart = startOfUtcDay(new Date());
    const todaysBids = await this.prisma.bid.findMany({
      where: { userId, createdAt: { gte: todayStart } },
      select: { auction: { select: { coinsPerBid: true } } },
    });
    const wagerToday = todaysBids.reduce(
      (sum, b) => sum + (b.auction?.coinsPerBid ?? 0),
      0,
    );
    const next = wagerToday + coinsToWager;
    if (next > profile.dailyWagerLimitCoins) {
      await this.recordBetBlock(
        userId,
        'daily_wager',
        profile.dailyWagerLimitCoins,
        coinsToWager,
      );
      throw new ForbiddenException(
        `Daily wager limit reached (${wagerToday}/${profile.dailyWagerLimitCoins} coins). Resets at next UTC midnight.`,
      );
    }
  }

  /**
   * Admin / self-service read of forensic events. Cursor pagination
   * over the index `(userId, createdAt desc)`.
   */
  async listEvents(userId: string, limit = 50, cursor?: string) {
    const safeLimit = Math.max(1, Math.min(200, limit));
    const rows = await this.prisma.responsibleGamblingEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: safeLimit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > safeLimit;
    return {
      items: (hasMore ? rows.slice(0, safeLimit) : rows).map((r) => ({
        id: r.id,
        kind: r.kind,
        limitKind: r.limitKind,
        limitValue: r.limitValue,
        amount: r.amount,
        sessionDurationMs: r.sessionDurationMs,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? rows[safeLimit - 1].id : null,
    };
  }

  private async recordBetBlock(
    userId: string,
    limitKind: string,
    limitValue: number | null,
    amount: number,
  ) {
    try {
      await this.prisma.responsibleGamblingEvent.create({
        data: {
          userId,
          kind: RgEventKind.BET_BLOCKED_BY_LIMIT,
          limitKind,
          limitValue,
          amount,
        },
      });
    } catch (err) {
      // Never fail the bet block because of an audit-write failure.
      this.logger.warn(
        `failed to record RG bet block for ${userId}: ${(err as Error).message}`,
      );
    }
  }
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function humanDuration(ms: number): string {
  const days = Math.round(ms / 86_400_000);
  if (days >= 30 && days % 30 === 0) return `${days / 30} month${days === 30 ? '' : 's'}`;
  if (days >= 7 && days % 7 === 0) return `${days / 7} week${days === 7 ? '' : 's'}`;
  return `${days} day${days === 1 ? '' : 's'}`;
}
