import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FraudSeverity, FraudSignalKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../foundation/audit-log.service';
import { SettingsService } from '../foundation/settings.service';

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
    const take = Math.min(50, Math.max(1, input.limit ?? 25));
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
    return {
      items: rows.slice(0, take),
      nextCursor: rows.length > take ? rows[take].id : null,
    };
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
