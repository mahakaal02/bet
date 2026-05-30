import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OutboxKind, Prisma, ReferralStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { isUniqueViolation } from '../common/prisma-errors';
import { OutboxService } from '../foundation/outbox.service';
import { SettingsService } from '../foundation/settings.service';
import { NotificationService } from '../foundation/notification.service';

/**
 * Referral lifecycle (Roadmap §F-USER-4).
 *
 * Three states a referee → referrer relationship can be in:
 *
 *   PENDING   — claim created at signup; we know who referred whom,
 *               but the referee hasn't met the qualification bar yet.
 *   QUALIFIED — referee hit BOTH gates (KYC tier ≥ 1 + first deposit
 *               ≥ minimum). Payout queued via outbox; no coins yet on
 *               either side until the Bet wallet dispatcher acks.
 *   PAID      — outbox dispatcher confirmed both credits landed.
 *   VOIDED    — manually voided by an admin (suspected fraud, code
 *               collision, etc.) — coins NOT released.
 *
 * Anti-fraud:
 *   - One referee → one referrer (refereeId is unique).
 *   - Self-referral refused (refererId === refereeId).
 *   - IP + device-hash fingerprints captured at signup so the admin
 *     can spot pattern fraud post-hoc (5 referees from the same IP
 *     within 1h, etc.). The voiding workflow consumes these.
 *
 * Code generation:
 *   - 8-char base32 (avoid 0/O/1/I/l) — short enough to share
 *     verbally, long enough to defeat brute-force guess fishing.
 *   - One per user, immutable once set — referrers tend to share
 *     their code on social media and we don't want the URL to rot.
 *
 * Payout shape: two OutboxKind=BET_WALLET_CREDIT rows in the same
 * transaction that flips PENDING → QUALIFIED. The dispatcher (lives
 * in bet-wallet/) consumes those rows + calls Bet. Each row has a
 * deterministic `idempotencyKey` (`referral:<claimId>:referrer` /
 * `referral:<claimId>:referee`) so a retry never double-credits.
 */
@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  // Character set: base32 minus the visually-ambiguous glyphs.
  private static readonly CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  private static readonly CODE_LENGTH = 8;
  private static readonly MAX_CODE_ATTEMPTS = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Idempotent: returns the user's existing referral code, or mints
   * a fresh one if `User.referralCode` is still null.
   */
  async ensureCode(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, referralCode: true },
    });
    if (!user) throw new NotFoundException('user not found');
    if (user.referralCode) return user.referralCode;

    for (let attempt = 0; attempt < ReferralsService.MAX_CODE_ATTEMPTS; attempt++) {
      const candidate = ReferralsService.generateCode();
      try {
        const updated = await this.prisma.user.update({
          where: { id: userId },
          data: { referralCode: candidate },
          select: { referralCode: true },
        });
        return updated.referralCode!;
      } catch (err: unknown) {
        // P2002 — unique violation on referralCode. Try again with a
        // fresh random. Collision probability at 32^8 keyspace is
        // ~1e-12 per pair, so this loop rarely fires twice.
        if (isUniqueViolation(err)) continue;
        throw err;
      }
    }
    throw new Error('referral_code_collision_exhausted');
  }

  /**
   * Read the user's referral summary — code, claim counts by status,
   * total coins earned so far.
   */
  async getMyReferrals(userId: string): Promise<{
    code: string;
    counts: Record<ReferralStatus, number>;
    totalCoinsEarned: number;
    rewardCoins: number;
  }> {
    const code = await this.ensureCode(userId);
    const claims = await this.prisma.referralClaim.findMany({
      where: { referrerId: userId },
      select: { status: true, referrerRewardCoins: true, paidAt: true },
    });
    const counts: Record<ReferralStatus, number> = {
      PENDING: 0,
      QUALIFIED: 0,
      PAID: 0,
      VOIDED: 0,
    };
    let totalCoinsEarned = 0;
    for (const c of claims) {
      counts[c.status] += 1;
      if (c.status === ReferralStatus.PAID) totalCoinsEarned += c.referrerRewardCoins;
    }
    const rewardCoins = await this.settings.getInt('referral.referrer_reward_coins', 500);
    return { code, counts, totalCoinsEarned, rewardCoins };
  }

  /**
   * Bind a referrer to a freshly-signed-up referee. Called from the
   * signup path (auth.service) when the
   * incoming request carries `?ref=<code>` or a body `referralCode`
   * field.
   *
   * Refuses if:
   *   - The referee already has a claim (one-shot).
   *   - The code matches the referee themselves (self-referral).
   *   - The code doesn't resolve to any user.
   */
  async claim(input: {
    refereeUserId: string;
    code: string;
    signupIp?: string;
    signupDeviceHash?: string;
  }): Promise<{ claimId: string; status: ReferralStatus }> {
    const normalised = input.code.trim().toUpperCase();
    if (!normalised) throw new BadRequestException({ code: 'REFERRAL_CODE_REQUIRED' });

    const referrer = await this.prisma.user.findUnique({
      where: { referralCode: normalised },
      select: { id: true },
    });
    if (!referrer) {
      throw new BadRequestException({ code: 'REFERRAL_CODE_NOT_FOUND' });
    }
    if (referrer.id === input.refereeUserId) {
      throw new BadRequestException({ code: 'REFERRAL_SELF_REFUSED' });
    }

    // One-shot uniqueness is enforced at the DB layer (refereeId is
    // unique). We translate the constraint violation into a tidy
    // 409 here so the signup error is helpful.
    const referrerReward = await this.settings.getInt('referral.referrer_reward_coins', 500);
    const refereeReward = await this.settings.getInt('referral.referee_reward_coins', 250);

    try {
      const claim = await this.prisma.referralClaim.create({
        data: {
          referrerId: referrer.id,
          refereeId: input.refereeUserId,
          code: normalised,
          status: ReferralStatus.PENDING,
          referrerRewardCoins: referrerReward,
          refereeRewardCoins: refereeReward,
          refereeSignupIp: input.signupIp ?? null,
          refereeSignupDeviceHash: input.signupDeviceHash ?? null,
        },
      });
      return { claimId: claim.id, status: claim.status };
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({ code: 'REFERRAL_ALREADY_CLAIMED' });
      }
      throw err;
    }
  }

  /**
   * Try to qualify any PENDING claim where this user is the referee.
   * Called from:
   *   - KycService (after the first tier promotion to ≥ TIER_1)
   *   - PaymentsService (after the first successful top-up)
   *
   * Idempotent: a second call after qualification just re-reads the
   * row and returns. Outbox rows are written exactly once per claim
   * thanks to the deterministic idempotencyKey.
   */
  async maybeQualify(refereeUserId: string): Promise<{
    qualified: boolean;
    claimId?: string;
  }> {
    const claim = await this.prisma.referralClaim.findUnique({
      where: { refereeId: refereeUserId },
    });
    if (!claim) return { qualified: false };
    if (claim.status !== ReferralStatus.PENDING) {
      return { qualified: claim.status === ReferralStatus.QUALIFIED || claim.status === ReferralStatus.PAID, claimId: claim.id };
    }

    // Re-check the gates. Both must be satisfied.
    const kyc = await this.prisma.kycVerification.findUnique({
      where: { userId: refereeUserId },
      select: { tier: true },
    });
    const kycOk = kyc !== null && kyc.tier !== 'TIER_0';

    const minDeposit = await this.settings.getInt('referral.qualification_deposit_min_coins', 1000);
    const deposits = await this.prisma.coinTransaction.aggregate({
      where: { userId: refereeUserId, reason: 'coin_purchase' },
      _sum: { delta: true },
    });
    const totalDeposited = deposits._sum.delta ?? 0;
    const depositOk = totalDeposited >= minDeposit;

    if (!kycOk || !depositOk) {
      return { qualified: false, claimId: claim.id };
    }

    // Flip + enqueue payouts atomically, guarded against a concurrent
    // qualify. The two gates are tripped by different events (KYC
    // promotion vs first deposit), so both can land at the same
    // instant and call this together. The conditional
    // `updateMany(where status=PENDING)` lets exactly one caller win
    // the flip; the loser sees `count === 0` and returns without
    // re-enqueuing. Without this guard the loser's enqueue would hit
    // the unique constraint on `Outbox.idempotencyKey` and throw P2002
    // up into the KYC / payment flow that triggered it.
    const now = new Date();
    const won = await this.prisma.$transaction(async (tx) => {
      const flip = await tx.referralClaim.updateMany({
        where: { id: claim.id, status: ReferralStatus.PENDING },
        data: { status: ReferralStatus.QUALIFIED, qualifiedAt: now },
      });
      if (flip.count === 0) return false;
      await this.outbox.enqueue(tx, {
        kind: OutboxKind.BET_WALLET_CREDIT,
        sourceTable: 'ReferralClaim',
        sourceId: claim.id,
        payload: {
          userId: claim.referrerId,
          amount: claim.referrerRewardCoins,
          kind: 'referral_reward_referrer',
          reference: `referral:${claim.id}:referrer`,
          metadata: { claimId: claim.id, role: 'referrer' },
        },
        idempotencyKey: `referral:${claim.id}:referrer`,
      });
      await this.outbox.enqueue(tx, {
        kind: OutboxKind.BET_WALLET_CREDIT,
        sourceTable: 'ReferralClaim',
        sourceId: claim.id,
        payload: {
          userId: claim.refereeId,
          amount: claim.refereeRewardCoins,
          kind: 'referral_reward_referee',
          reference: `referral:${claim.id}:referee`,
          metadata: { claimId: claim.id, role: 'referee' },
        },
        idempotencyKey: `referral:${claim.id}:referee`,
      });
      return true;
    });

    // Concurrent loser: another call already flipped this claim and
    // owns the payout + notification. Report success without redoing
    // either.
    if (!won) {
      return { qualified: true, claimId: claim.id };
    }

    // Best-effort notification to the referrer. INAPP via the
    // standard pipeline; the template is referral_qualified_v1
    // (introduced by PR-NOTIFY-2's catalog expansion).
    try {
      await this.notifications.enqueue({
        templateCode: 'referral_qualified_v1',
        userId: claim.referrerId,
        payload: {
          username: '',
          refereeUsername: '',                            // filled in by the renderer if available
          coins: String(claim.referrerRewardCoins),
        },
        idempotencyAnchor: `referral_qualified:${claim.id}`,
      });
    } catch (err) {
      this.logger.warn(
        `referral notification enqueue failed for claim ${claim.id}: ${(err as Error).message}`,
      );
    }

    return { qualified: true, claimId: claim.id };
  }

  /**
   * Admin tool — void a claim. Pulled trigger-able from the admin
   * console when fraud patterns surface (5 referees from the same
   * IP within 1h, suspicious device hashes, etc.). Bypasses the
   * outbox: a VOIDED claim has no payouts queued.
   *
   * If the claim is already PAID, voiding is harder — we'd have to
   * claw back coins via Bet's negative-credit path. Out of scope
   * here; we throw a Conflict telling the admin to do it manually.
   */
  async voidClaim(input: {
    adminId: string;
    claimId: string;
    reason: string;
  }): Promise<{ claimId: string; status: ReferralStatus }> {
    if (input.reason.trim().length < 4) {
      throw new BadRequestException({ code: 'REFERRAL_VOID_REASON_REQUIRED' });
    }
    const claim = await this.prisma.referralClaim.findUnique({
      where: { id: input.claimId },
    });
    if (!claim) throw new NotFoundException({ code: 'REFERRAL_CLAIM_NOT_FOUND' });
    if (claim.status === ReferralStatus.PAID) {
      throw new ConflictException({
        code: 'REFERRAL_ALREADY_PAID',
        message:
          'Coins already credited. Use the admin wallet adjust tool to claw back; do not void here.',
      });
    }
    const updated = await this.prisma.referralClaim.update({
      where: { id: input.claimId },
      data: { status: ReferralStatus.VOIDED, voidReason: input.reason },
    });
    void input.adminId; // adminAuditLog hook lives at controller layer
    return { claimId: updated.id, status: updated.status };
  }

  // ─── helpers ──────────────────────────────────────────────────

  static generateCode(): string {
    const bytes = randomBytes(ReferralsService.CODE_LENGTH);
    const out: string[] = [];
    for (const b of bytes) {
      out.push(ReferralsService.CODE_ALPHABET[b % ReferralsService.CODE_ALPHABET.length]);
    }
    return out.join('');
  }
}
