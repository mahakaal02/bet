import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FraudSeverity, FraudSignalKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../foundation/audit-log.service';
import { SettingsService } from '../foundation/settings.service';
import { clampPageLimit, cursorPage } from '../common/pagination';

/**
 * Fraud heuristics (Roadmap §F-ADMIN-7).
 *
 * Two flavours of detector:
 *
 *   1. **Velocity** — too many of one event-type for a single user
 *      in a tight time window. Today we cover bids; login / withdrawal
 *      slots are reserved in the enum + service for FRAUD-2.
 *   2. **Cluster** — same IP / device hash / referrer across multiple
 *      users. The referral table's anti-fraud fingerprints (Roadmap
 *      §F-USER-4) get consumed here.
 *
 * Output: a `FraudSignal` row per fired rule. Never auto-blocks —
 * humans review. The admin queue (this service's REST surface) sorts
 * unreviewed-first by severity → createdAt.
 *
 * Thresholds are SystemSetting rows so security can re-tune them
 * without a redeploy. Defaults err on the LOW-noise side; collecting
 * a baseline in prod tightens them later.
 *
 * Severity heuristic:
 *   - 1× threshold → LOW
 *   - 2× threshold → MEDIUM
 *   - 5× threshold → HIGH
 * This keeps the queue sortable without a per-rule lookup table.
 */
@Injectable()
export class FraudService {
  private readonly logger = new Logger(FraudService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly settings: SettingsService,
  ) {}

  // ─── Velocity detectors ───────────────────────────────────────

  /**
   * Bid velocity. Called from BidsService.placeBid after the bid
   * commits. Counts the user's bids in the configured window; if
   * over threshold, writes a VELOCITY_BID signal (deduped per
   * window so we don't write one row per bid above the threshold).
   */
  async checkBidVelocity(userId: string, now: Date = new Date()): Promise<void> {
    const threshold = await this.settings.getInt('fraud.velocity_bid_count', 30);
    const windowMs = await this.settings.getInt('fraud.velocity_bid_window_ms', 60_000);
    const windowStart = new Date(now.getTime() - windowMs);

    const count = await this.prisma.bid.count({
      where: { userId, createdAt: { gte: windowStart } },
    });
    if (count < threshold) return;

    // Dedupe — already a signal for this user in this window?
    const existing = await this.prisma.fraudSignal.findFirst({
      where: {
        kind: FraudSignalKind.VELOCITY_BID,
        userId,
        createdAt: { gte: windowStart },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return;

    await this.emit({
      kind: FraudSignalKind.VELOCITY_BID,
      severity: FraudService.severityFor(count, threshold),
      userId,
      metadata: { count, threshold, windowMs },
    });
  }

  // ─── Cluster detectors ────────────────────────────────────────

  /**
   * Referral-IP cluster. Reads `ReferralClaim.refereeSignupIp` and
   * flags any IP that appears against ≥ `cluster_ip_min_users` distinct
   * referees within the last 30 days. Run from the nightly cron (or
   * on-demand via the admin trigger).
   */
  async detectIpClusters(): Promise<{ created: number }> {
    const minUsers = await this.settings.getInt('fraud.cluster_ip_min_users', 3);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60_000);

    // Group by IP across recent referral claims.
    const groups = await this.prisma.referralClaim.groupBy({
      by: ['refereeSignupIp'],
      where: { refereeSignupIp: { not: null }, createdAt: { gte: since } },
      _count: { refereeId: true },
    });
    let created = 0;
    for (const g of groups) {
      const count = g._count.refereeId;
      if (count < minUsers) continue;
      // Pull the referee ids for the metadata bundle.
      const claims = await this.prisma.referralClaim.findMany({
        where: { refereeSignupIp: g.refereeSignupIp, createdAt: { gte: since } },
        select: { refereeId: true },
      });
      const userIds = claims.map((c) => c.refereeId);

      // Dedupe — has a signal already been emitted for this IP within the window?
      const existing = await this.prisma.fraudSignal.findFirst({
        where: {
          kind: FraudSignalKind.CLUSTER_IP,
          clusterKey: g.refereeSignupIp!,
          createdAt: { gte: since },
        },
      });
      if (existing) continue;

      await this.emit({
        kind: FraudSignalKind.CLUSTER_IP,
        severity: FraudService.severityFor(count, minUsers),
        clusterKey: g.refereeSignupIp!,
        affectedUserIds: userIds,
        metadata: { count, minUsers, windowDays: 30 },
      });
      created += 1;
    }
    return { created };
  }

  /**
   * Referral-device cluster. Same shape as IP but groups on
   * `refereeSignupDeviceHash`. Detects users on the same physical
   * device (browser+OS fingerprint) signing up under different
   * referrers — classic abuse pattern.
   */
  async detectDeviceClusters(): Promise<{ created: number }> {
    const minUsers = await this.settings.getInt('fraud.cluster_device_min_users', 3);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60_000);

    const groups = await this.prisma.referralClaim.groupBy({
      by: ['refereeSignupDeviceHash'],
      where: { refereeSignupDeviceHash: { not: null }, createdAt: { gte: since } },
      _count: { refereeId: true },
    });
    let created = 0;
    for (const g of groups) {
      const count = g._count.refereeId;
      if (count < minUsers) continue;
      const claims = await this.prisma.referralClaim.findMany({
        where: { refereeSignupDeviceHash: g.refereeSignupDeviceHash, createdAt: { gte: since } },
        select: { refereeId: true },
      });
      const userIds = claims.map((c) => c.refereeId);

      const existing = await this.prisma.fraudSignal.findFirst({
        where: {
          kind: FraudSignalKind.CLUSTER_DEVICE,
          clusterKey: g.refereeSignupDeviceHash!,
          createdAt: { gte: since },
        },
      });
      if (existing) continue;

      await this.emit({
        kind: FraudSignalKind.CLUSTER_DEVICE,
        severity: FraudService.severityFor(count, minUsers),
        clusterKey: g.refereeSignupDeviceHash!,
        affectedUserIds: userIds,
        metadata: { count, minUsers, windowDays: 30 },
      });
      created += 1;
    }
    return { created };
  }

  /**
   * Referrer-velocity: one user inviting many referees inside 24h.
   * Distinct from CLUSTER_IP (which catches different referrers
   * sharing infra). Both can fire on the same network.
   */
  async detectReferralVelocity(): Promise<{ created: number }> {
    const minRef = await this.settings.getInt('fraud.cluster_referral_min_referees', 5);
    const since = new Date(Date.now() - 24 * 60 * 60_000);

    const groups = await this.prisma.referralClaim.groupBy({
      by: ['referrerId'],
      where: { createdAt: { gte: since } },
      _count: { refereeId: true },
    });
    let created = 0;
    for (const g of groups) {
      const count = g._count.refereeId;
      if (count < minRef) continue;
      const claims = await this.prisma.referralClaim.findMany({
        where: { referrerId: g.referrerId, createdAt: { gte: since } },
        select: { refereeId: true },
      });
      const userIds = claims.map((c) => c.refereeId);

      const existing = await this.prisma.fraudSignal.findFirst({
        where: {
          kind: FraudSignalKind.CLUSTER_REFERRAL,
          clusterKey: g.referrerId,
          createdAt: { gte: since },
        },
      });
      if (existing) continue;

      await this.emit({
        kind: FraudSignalKind.CLUSTER_REFERRAL,
        severity: FraudService.severityFor(count, minRef),
        clusterKey: g.referrerId,
        affectedUserIds: userIds,
        metadata: { count, minRef, windowHours: 24 },
      });
      created += 1;
    }
    return { created };
  }

  /** Run all cluster detectors. Cron entrypoint. */
  async runClusterSweep(): Promise<{ ipClusters: number; deviceClusters: number; referralClusters: number }> {
    const ip = await this.detectIpClusters();
    const device = await this.detectDeviceClusters();
    const ref = await this.detectReferralVelocity();
    return { ipClusters: ip.created, deviceClusters: device.created, referralClusters: ref.created };
  }

  // ─── Admin REST ──────────────────────────────────────────────

  async listSignals(input: {
    reviewed?: boolean;
    severity?: FraudSeverity;
    kind?: FraudSignalKind;
    cursor?: string;
    limit?: number;
  }) {
    const take = clampPageLimit(input.limit);
    const rows = await this.prisma.fraudSignal.findMany({
      where: {
        ...(input.reviewed !== undefined ? { reviewed: input.reviewed } : {}),
        ...(input.severity ? { severity: input.severity } : {}),
        ...(input.kind ? { kind: input.kind } : {}),
      },
      orderBy: [
        { reviewed: 'asc' },
        // Custom severity sort would need raw SQL — Prisma supports
        // the enum's natural lexical order. Our enum is declared
        // LOW < MEDIUM < HIGH, so desc sort puts HIGH first.
        { severity: 'desc' },
        { createdAt: 'desc' },
      ],
      take: take + 1,
      ...(input.cursor ? { skip: 1, cursor: { id: input.cursor } } : {}),
    });
    const { page, nextCursor } = cursorPage(rows, take);
    return { items: page, nextCursor };
  }

  /**
   * Mark a signal reviewed. Optional notes (≥ 4 chars). Idempotent.
   */
  async reviewSignal(input: {
    adminId: string;
    adminEmail: string;
    signalId: string;
    notes?: string;
  }) {
    if (input.notes !== undefined && input.notes.trim().length < 4) {
      throw new BadRequestException({ code: 'NOTES_TOO_SHORT' });
    }
    const signal = await this.prisma.fraudSignal.findUnique({ where: { id: input.signalId } });
    if (!signal) throw new NotFoundException({ code: 'SIGNAL_NOT_FOUND' });
    if (signal.reviewed) {
      return { signalId: signal.id, reviewed: true };
    }
    await this.prisma.fraudSignal.update({
      where: { id: input.signalId },
      data: {
        reviewed: true,
        reviewedBy: input.adminId,
        reviewedAt: new Date(),
        notes: input.notes?.trim() ?? null,
      },
    });
    await this.audit.record({
      actorId: input.adminId,
      actorEmail: input.adminEmail,
      action: 'fraud.signal_reviewed',
      targetType: 'FraudSignal',
      targetId: input.signalId,
      before: { reviewed: false },
      after: { reviewed: true, notes: input.notes?.trim() ?? null },
    });
    return { signalId: signal.id, reviewed: true };
  }

  // ─── Bulk actions (PR-FRAUD-2) ────────────────────────────────

  /**
   * Bulk-ack many signals in one round-trip. The single-row
   * `reviewSignal()` is the right tool when an admin opens one
   * signal to investigate; this is the right tool when an admin
   * triages 20 LOW signals at the end of the day.
   *
   * Per-row notes aren't supported in the bulk form — instead the
   * caller passes one `batchNote` that gets applied to every row.
   * If a row is already reviewed, we skip it silently rather than
   * erroring (admins shouldn't have to refresh between selecting
   * rows and clicking).
   *
   * Audit row per signal, not per batch. Forensic trail stays
   * row-level and we avoid magic "batch" rows that don't line up
   * with the audit search UI.
   */
  async bulkReview(input: {
    adminId: string;
    adminEmail: string;
    signalIds: string[];
    batchNote?: string;
  }): Promise<{ reviewed: number; skipped: number }> {
    if (input.signalIds.length === 0) {
      throw new BadRequestException({ code: 'BULK_REVIEW_EMPTY' });
    }
    if (input.signalIds.length > 100) {
      throw new BadRequestException({ code: 'BULK_REVIEW_TOO_LARGE', max: 100 });
    }
    if (input.batchNote !== undefined && input.batchNote.trim().length < 4) {
      throw new BadRequestException({ code: 'NOTES_TOO_SHORT' });
    }
    const notes = input.batchNote?.trim() ?? null;

    // Read current state so the audit row's `before` is honest about
    // which rows were skipped (already-reviewed) vs newly-flipped.
    const rows = await this.prisma.fraudSignal.findMany({
      where: { id: { in: input.signalIds } },
    });
    const present = new Set(rows.map((r) => r.id));
    for (const id of input.signalIds) {
      if (!present.has(id)) {
        throw new NotFoundException({ code: 'SIGNAL_NOT_FOUND', signalId: id });
      }
    }

    const now = new Date();
    let reviewed = 0;
    let skipped = 0;
    for (const r of rows) {
      if (r.reviewed) {
        skipped += 1;
        continue;
      }
      await this.prisma.fraudSignal.update({
        where: { id: r.id },
        data: { reviewed: true, reviewedBy: input.adminId, reviewedAt: now, notes },
      });
      await this.audit.record({
        actorId: input.adminId,
        actorEmail: input.adminEmail,
        action: 'fraud.signal_reviewed_bulk',
        targetType: 'FraudSignal',
        targetId: r.id,
        before: { reviewed: false },
        after: { reviewed: true, notes },
      });
      reviewed += 1;
    }
    return { reviewed, skipped };
  }

  /**
   * Ban every user affected by a CLUSTER signal. Used on
   * obvious-fraud rings — the admin reviews the signal, confirms
   * the cluster is genuine abuse, then issues a coordinated ban
   * that captures the same `signalId` as the linkage so future
   * unbans can trace why each row was hit.
   *
   * Refuses on velocity (single-user) signals — those go through
   * a per-user ban path (which today is the existing admin user
   * controller; not in scope for this PR).
   *
   * Idempotent at the per-user level: already-banned users get
   * their `bannedReason` refreshed with the new signal id but no
   * second ban event written.
   *
   * Atomicity: all bans happen inside one Prisma transaction. If
   * any row fails the whole thing rolls back — better to skip the
   * batch than half-ban a 12-account ring.
   */
  async banAffectedUsers(input: {
    adminId: string;
    adminEmail: string;
    signalId: string;
    reason: string;
  }): Promise<{ signalId: string; bannedUserIds: string[]; alreadyBanned: string[] }> {
    if (input.reason.trim().length < 10) {
      throw new BadRequestException({ code: 'BAN_REASON_TOO_SHORT' });
    }
    const signal = await this.prisma.fraudSignal.findUnique({ where: { id: input.signalId } });
    if (!signal) throw new NotFoundException({ code: 'SIGNAL_NOT_FOUND' });

    if (signal.userId !== null) {
      // Velocity signal — single user. We refuse the cluster-ban path
      // and let the admin use the per-user ban endpoint, which has its
      // own audit + notification semantics.
      throw new BadRequestException({
        code: 'NOT_A_CLUSTER_SIGNAL',
        message: 'This is a velocity signal — use the per-user ban path on the user detail page.',
      });
    }

    const userIds = Array.isArray(signal.affectedUserIds)
      ? (signal.affectedUserIds as unknown as string[])
      : [];
    if (userIds.length === 0) {
      throw new BadRequestException({ code: 'NO_AFFECTED_USERS' });
    }

    const trimmedReason = input.reason.trim();
    const now = new Date();
    const banLabel = `fraud_cluster:${signal.id}: ${trimmedReason}`.slice(0, 500);

    const banned: string[] = [];
    const alreadyBanned: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, bannedAt: true },
      });
      const existingMap = new Map(existing.map((u) => [u.id, u.bannedAt]));
      for (const userId of userIds) {
        const wasBanned = existingMap.get(userId);
        if (wasBanned) {
          // Already banned — refresh the reason to point at this signal
          // but don't overwrite the original `bannedAt` so the forensic
          // timeline stays accurate.
          await tx.user.update({
            where: { id: userId },
            data: { bannedReason: banLabel, bannedBy: input.adminId },
          });
          alreadyBanned.push(userId);
        } else {
          await tx.user.update({
            where: { id: userId },
            data: { bannedAt: now, bannedReason: banLabel, bannedBy: input.adminId },
          });
          banned.push(userId);
        }
      }
    });

    // One audit row per user affected. Cheaper than packing N user ids
    // into a single row + makes the audit-log search-by-user trivial.
    for (const userId of banned) {
      await this.audit.record({
        actorId: input.adminId,
        actorEmail: input.adminEmail,
        action: 'fraud.user_banned',
        targetType: 'User',
        targetId: userId,
        after: { signalId: signal.id, reason: trimmedReason },
      });
    }
    for (const userId of alreadyBanned) {
      await this.audit.record({
        actorId: input.adminId,
        actorEmail: input.adminEmail,
        action: 'fraud.user_ban_refreshed',
        targetType: 'User',
        targetId: userId,
        after: { signalId: signal.id, reason: trimmedReason },
      });
    }

    // Mark the signal reviewed if it wasn't already — banning IS the
    // review action. Skip the audit double-write by not calling
    // reviewSignal directly.
    if (!signal.reviewed) {
      await this.prisma.fraudSignal.update({
        where: { id: signal.id },
        data: {
          reviewed: true,
          reviewedBy: input.adminId,
          reviewedAt: now,
          notes: `banned ${banned.length} user(s): ${trimmedReason}`.slice(0, 500),
        },
      });
    }

    return { signalId: signal.id, bannedUserIds: banned, alreadyBanned };
  }

  /**
   * Reverse a fraud-ban. Used when a cluster signal turns out to be
   * a false positive (e.g. office Wi-Fi triggered CLUSTER_IP for
   * legitimate colleagues). Audited per user; the original
   * `bannedAt` is wiped along with the reason / banner.
   *
   * Caller is responsible for verifying that the unban is the right
   * call — there's no automatic gate on whether the signal actually
   * fired against this user.
   */
  async unbanUser(input: {
    adminId: string;
    adminEmail: string;
    userId: string;
    reason: string;
  }) {
    if (input.reason.trim().length < 4) {
      throw new BadRequestException({ code: 'UNBAN_REASON_TOO_SHORT' });
    }
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, bannedAt: true, bannedReason: true },
    });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND' });
    if (!user.bannedAt) {
      return { userId: user.id, wasBanned: false };
    }
    // Snapshot the ban state BEFORE the update — Prisma mocks that
    // mutate the same object reference (and the real client under
    // certain configurations) would otherwise leak the cleared
    // post-update values into the audit `before` field. Same
    // aliasing trap fixed in PR-ADDRESS-1 / PR-PROFILE-1.
    const previousBan = {
      bannedAt: user.bannedAt.toISOString(),
      bannedReason: user.bannedReason,
    };
    await this.prisma.user.update({
      where: { id: input.userId },
      data: { bannedAt: null, bannedReason: null, bannedBy: null },
    });
    await this.audit.record({
      actorId: input.adminId,
      actorEmail: input.adminEmail,
      action: 'fraud.user_unbanned',
      targetType: 'User',
      targetId: input.userId,
      before: previousBan,
      after: { reason: input.reason.trim() },
    });
    return { userId: user.id, wasBanned: true };
  }

  // ─── helpers ──────────────────────────────────────────────────

  static severityFor(observed: number, threshold: number): FraudSeverity {
    if (observed >= threshold * 5) return FraudSeverity.HIGH;
    if (observed >= threshold * 2) return FraudSeverity.MEDIUM;
    return FraudSeverity.LOW;
  }

  private async emit(input: {
    kind: FraudSignalKind;
    severity: FraudSeverity;
    userId?: string;
    clusterKey?: string;
    affectedUserIds?: string[];
    metadata: Record<string, unknown>;
  }) {
    await this.prisma.fraudSignal.create({
      data: {
        kind: input.kind,
        severity: input.severity,
        userId: input.userId ?? null,
        clusterKey: input.clusterKey ?? null,
        affectedUserIds: (input.affectedUserIds ?? null) as unknown as Prisma.InputJsonValue,
        metadata: input.metadata as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
