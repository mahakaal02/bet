import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../foundation/notification.service';

/**
 * Account-deletion lifecycle (Roadmap §F-USER-12).
 *
 *   1. `request(userId, reason?)` — writes an AccountDeletion row with
 *      `effectiveAt = now + 30d`. The user retains full account access
 *      during the cool-off; on every login the UI shows a "you have
 *      X days left to cancel" banner.
 *
 *   2. `cancel(userId)` — sets `cancelledAt` on the active row. Users
 *      can cancel any number of times before the cool-off lapses.
 *
 *   3. `purge(userId)` — the actual PII scrub. Runs only after
 *      `effectiveAt` has passed AND no `cancelledAt` is set. Wipes
 *      identifying columns on the User row, cascades or anonymises
 *      child records, sets `purgedAt`. The cron that triggers this
 *      lands in PR-DELETION-2; for now `purge()` is exposed via the
 *      admin surface so operators can run it manually.
 *
 * PII scrub policy
 *
 *   - `User.email = null`, `passwordHash = '<purged>'` (invalid bcrypt),
 *     `username = 'deleted-<sha1-prefix>'`, `displayName = null`,
 *     `avatarKey = null`, `legalName = null`, `whatsappPhone = null`,
 *     `betUserId = null` (Bet side does its own purge — see
 *     PR-DELETION-2 Bet-side bridge), `referralCode = null`,
 *     `bannedReason = '<purged>'` so admin views still render.
 *   - The User ROW is kept so foreign keys on Bid/Auction/etc.
 *     remain valid — anonymisation, not deletion.
 *   - Forensic + audit tables are NOT scrubbed: `AdminAuditLog`,
 *     `UserProfileHistory`, `ResponsibleGamblingEvent`,
 *     `DailyLoginClaim` (for reconciliation reports). They are
 *     financial / regulatory records and survive deletion.
 *
 * Login behaviour during purge
 *
 *   Pre-purge (effectiveAt in the future): login works normally;
 *   the auth response carries a `pendingDeletion` flag so the UI
 *   can render the warning banner.
 *   Post-purge (purgedAt set): the user can't log in — the
 *   `<purged>` passwordHash never matches bcrypt and the account
 *   identifier columns are wiped. This is enforced organically by
 *   bcrypt + the missing email; we don't need a separate gate.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);
  private static readonly COOL_OFF_DAYS = 30;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /** Return the current deletion state for the user (active row only). */
  async status(userId: string) {
    const row = await this.prisma.accountDeletion.findUnique({
      where: { userId },
    });
    if (!row || row.cancelledAt) {
      return { pending: false } as const;
    }
    return {
      pending: true,
      requestedAt: row.requestedAt.toISOString(),
      effectiveAt: row.effectiveAt.toISOString(),
      purgedAt: row.purgedAt?.toISOString() ?? null,
      reason: row.reason,
      // Convenience for the UI countdown.
      daysRemaining: Math.max(
        0,
        Math.ceil((row.effectiveAt.getTime() - Date.now()) / 86_400_000),
      ),
    } as const;
  }

  async request(userId: string, reason?: string) {
    const existing = await this.prisma.accountDeletion.findUnique({
      where: { userId },
    });
    if (existing && !existing.cancelledAt && !existing.purgedAt) {
      throw new ConflictException(
        `Deletion already requested — effective ${existing.effectiveAt.toISOString()}. Cancel first if you want to restart the cool-off.`,
      );
    }
    if (existing?.purgedAt) {
      throw new BadRequestException('account already purged');
    }
    const now = new Date();
    const effectiveAt = new Date(
      now.getTime() + AccountDeletionService.COOL_OFF_DAYS * 86_400_000,
    );

    // Upsert because `userId` is unique — a previously-cancelled
    // request gets a fresh window without violating the constraint.
    const row = await this.prisma.accountDeletion.upsert({
      where: { userId },
      update: {
        reason: reason ?? null,
        requestedAt: now,
        effectiveAt,
        cancelledAt: null,
        purgedAt: null,
      },
      create: {
        userId,
        reason: reason ?? null,
        requestedAt: now,
        effectiveAt,
      },
    });

    void this.notifications
      .enqueue({
        templateCode: 'account_deletion_requested_v1',
        userId,
        payload: {
          effectiveAt: effectiveAt.toISOString(),
          daysRemaining: String(AccountDeletionService.COOL_OFF_DAYS),
        },
        idempotencyAnchor: `acct_del_req:${row.id}`,
        channels: [NotificationChannel.EMAIL, NotificationChannel.INAPP],
      })
      .catch((err) => {
        this.logger.warn(
          `account_deletion_requested notification failed: ${(err as Error).message}`,
        );
      });

    return {
      requestedAt: row.requestedAt.toISOString(),
      effectiveAt: row.effectiveAt.toISOString(),
    };
  }

  async cancel(userId: string) {
    const row = await this.prisma.accountDeletion.findUnique({
      where: { userId },
    });
    if (!row || row.cancelledAt || row.purgedAt) {
      throw new NotFoundException('no active deletion request to cancel');
    }
    if (row.effectiveAt.getTime() < Date.now()) {
      // Cool-off already passed. Cancellation is no longer the user's
      // call — they need support.
      throw new BadRequestException(
        'cool-off window has passed; contact support to reverse the purge',
      );
    }
    await this.prisma.accountDeletion.update({
      where: { userId },
      data: { cancelledAt: new Date() },
    });

    void this.notifications
      .enqueue({
        templateCode: 'account_deletion_cancelled_v1',
        userId,
        payload: {},
        idempotencyAnchor: `acct_del_cancel:${row.id}:${Date.now()}`,
        channels: [NotificationChannel.EMAIL, NotificationChannel.INAPP],
      })
      .catch((err) => {
        this.logger.warn(
          `account_deletion_cancelled notification failed: ${(err as Error).message}`,
        );
      });

    return { cancelled: true };
  }

  /**
   * Purge the user's PII. Idempotent — calling twice on an already-
   * purged row is a no-op. Refuses if the cool-off hasn't elapsed
   * (admin enforcement; a cron caller would never trigger this path
   * but defence-in-depth).
   */
  async purge(userId: string): Promise<{ purged: boolean }> {
    const row = await this.prisma.accountDeletion.findUnique({
      where: { userId },
    });
    if (!row) throw new NotFoundException('no deletion request');
    if (row.cancelledAt) {
      throw new BadRequestException('deletion was cancelled');
    }
    if (row.purgedAt) return { purged: true };          // idempotent
    if (row.effectiveAt.getTime() > Date.now()) {
      throw new BadRequestException(
        `cool-off has not elapsed (effective ${row.effectiveAt.toISOString()})`,
      );
    }

    // Anonymise the User row + clear all auxiliary data. Forensic
    // / regulatory tables retained per the service header.
    const shortId = userId.slice(0, 8);
    const purgedUsername = `deleted-${shortId}`;
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          email: null,
          passwordHash: '<purged>',
          username: purgedUsername,
          displayName: null,
          avatarKey: null,
          legalName: null,
          whatsappPhone: null,
          betUserId: null,
          referralCode: null,
          bannedReason: '<purged>',
          passwordChangedAt: new Date(),               // invalidates every JWT
          emailVerified: false,
        },
      }),
      this.prisma.accountDeletion.update({
        where: { userId },
        data: { purgedAt: new Date() },
      }),
      // Cascade the auxiliary auth + session material. The
      // `User.passwordChangedAt` bump above invalidates every
      // existing JWT, but explicit cleanup keeps queries on those
      // tables tidy (and stops a stale TwoFactorAuth row from
      // looking like "this user still has 2FA enabled").
      this.prisma.twoFactorAuth.deleteMany({ where: { userId } }),
      this.prisma.trustedDevice.deleteMany({ where: { userId } }),
      this.prisma.passwordReset.deleteMany({ where: { userId } }),
      this.prisma.emailChangeRequest.deleteMany({ where: { userId } }),
      this.prisma.notificationPreference.deleteMany({ where: { userId } }),
      this.prisma.deviceToken.deleteMany({ where: { userId } }),
      this.prisma.watchlist.deleteMany({ where: { userId } }),
      this.prisma.shippingAddress.deleteMany({ where: { userId } }),
    ]);

    return { purged: true };
  }

  /**
   * Build the GDPR/DPDP data export. Returns a serialisable JSON
   * payload of everything we hold keyed on this user. Synchronous
   * for MVP — the dataset for a single user fits in memory at our
   * scale. Worker-based async export with signed-URL downloads
   * lands as a follow-up (Roadmap §F-USER-2).
   */
  async exportData(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        legalName: true,
        avatarKey: true,
        whatsappPhone: true,
        phoneVerified: true,
        emailVerified: true,
        isAdmin: true,
        referralCode: true,
        bannedAt: true,
        bannedReason: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('user not found');

    const [
      bids,
      notifications,
      profileHistory,
      passwordResets,
      addresses,
      watchlist,
      rgProfile,
      rgEvents,
      dailyClaims,
      twoFactor,
      trustedDevices,
    ] = await Promise.all([
      this.prisma.bid.findMany({
        where: { userId },
        select: { id: true, auctionId: true, amount: true, createdAt: true },
      }),
      this.prisma.notification.findMany({
        where: { userId },
        select: {
          id: true,
          templateCode: true,
          channel: true,
          status: true,
          createdAt: true,
          readAt: true,
        },
      }),
      this.prisma.userProfileHistory.findMany({
        where: { userId },
        select: { field: true, before: true, after: true, changedAt: true },
        orderBy: { changedAt: 'desc' },
      }),
      this.prisma.passwordReset.findMany({
        where: { userId },
        select: {
          id: true,
          requestedIp: true,
          usedAt: true,
          expiresAt: true,
          createdAt: true,
        },
      }),
      this.prisma.shippingAddress.findMany({ where: { userId } }),
      this.prisma.watchlist.findMany({
        where: { userId },
        select: { auctionId: true, createdAt: true },
      }),
      this.prisma.responsibleGamblingProfile.findUnique({ where: { userId } }),
      this.prisma.responsibleGamblingEvent.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.dailyLoginClaim.findMany({
        where: { userId },
        orderBy: { claimDateUtc: 'desc' },
      }),
      this.prisma.twoFactorAuth.findUnique({
        where: { userId },
        select: {
          verified: true,
          enabledAt: true,
          disabledAt: true,
          createdAt: true,
        },
      }),
      this.prisma.trustedDevice.findMany({
        where: { userId },
        select: {
          id: true,
          label: true,
          lastSeenAt: true,
          expiresAt: true,
        },
      }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      user,
      bids,
      notifications,
      profileHistory,
      passwordResets,
      addresses,
      watchlist,
      responsibleGambling: {
        profile: rgProfile,
        events: rgEvents,
      },
      dailyLoginClaims: dailyClaims,
      twoFactor,
      trustedDevices,
    };
  }
}
