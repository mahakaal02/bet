import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  DocumentKind,
  KycTier,
  KycVerification,
  ReviewState,
  ScanStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../foundation/audit-log.service';
import { SettingsService } from '../foundation/settings.service';
import { ReferralsService } from '../referrals/referrals.service';
import { isUniqueViolation } from '../common/prisma-errors';
import { clampPageLimit, cursorPage } from '../common/pagination';
import { KYC_STORAGE, type KycStorage } from './kyc.tokens';
import { VIRUS_SCANNER, type VirusScanner } from './kyc.tokens';
import { DOCUMENT_CIPHER, type DocumentCipher } from './kyc.tokens';

/**
 * KYC service (Roadmap §F-USER-13).
 *
 * Tier ladder:
 *
 *   - **TIER_0** — fresh signup. Bidding allowed, withdrawal capped
 *     at `kyc.tier0_max_withdrawal_coins` (default 0 = blocked).
 *   - **TIER_1** — phone + email verified.
 *     `kyc.tier1_max_withdrawal_coins` (default 5_000).
 *   - **TIER_2** — TIER_1 + PAN (or passport) verified.
 *     `kyc.tier2_max_withdrawal_coins` (default 50_000).
 *   - **TIER_3** — TIER_2 + address proof + selfie + admin approval.
 *     unlimited withdrawal (`kyc.tier3_max_withdrawal_coins` =
 *     `-1` sentinel).
 *
 * Document pipeline:
 *
 *   1. Multipart upload reaches the controller (≤ 10 MiB enforced by
 *      Multer; the service trusts the buffer size here but double-
 *      checks against `kyc.max_document_bytes` for parity).
 *   2. **Virus scan** the raw bytes — if INFECTED, we never persist
 *      the blob, write an AdminAuditLog row for the security team,
 *      and surface `400 KYC_INFECTED_DOCUMENT` to the user.
 *   3. **Encrypt** with the document cipher (AES-256-GCM today, KMS
 *      tomorrow). The plaintext is GC'd after `put`.
 *   4. **Store** ciphertext + persist a `KycDocument` row referencing
 *      the storage key. Row is created in `PENDING` review state —
 *      admin queue (PR-KYC-2) approves/rejects.
 *
 * Auto-tier promotion: when a user finishes a step (e.g. PAN uploaded
 * and OCR matches their entered PAN), `recomputeTier()` lifts the
 * tier without an admin in the loop. Admin only required for TIER_3
 * (address proof needs eyeballs to confirm the photo is real).
 */
@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  // Max document size — guarded both at Multer config and here so a
  // bypass of one (e.g. direct SDK upload) doesn't slip through.
  static readonly MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MiB

  // Allowed mime types per document kind. We enforce this in the
  // service (not just at the controller) so the audit story is the
  // same regardless of the upload path.
  static readonly MIME_ALLOWLIST: Record<DocumentKind, readonly string[]> = {
    PAN: ['image/jpeg', 'image/png', 'application/pdf'],
    AADHAAR_LAST4: ['image/jpeg', 'image/png', 'application/pdf'],
    PASSPORT: ['image/jpeg', 'image/png', 'application/pdf'],
    VOTER_ID: ['image/jpeg', 'image/png', 'application/pdf'],
    ADDRESS_PROOF: ['image/jpeg', 'image/png', 'application/pdf'],
    SELFIE: ['image/jpeg', 'image/png'],
    LIVENESS_VIDEO: ['video/mp4', 'video/webm'],
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly settings: SettingsService,
    @Inject(KYC_STORAGE) private readonly storage: KycStorage,
    @Inject(VIRUS_SCANNER) private readonly scanner: VirusScanner,
    @Inject(DOCUMENT_CIPHER) private readonly cipher: DocumentCipher,
    // Optional: KYC promotion is a documented trigger for referral
    // qualification (a referee who hits KYC TIER_1 satisfies one of
    // the two referral gates). Best-effort + optional so KYC promotion
    // never hard-depends on the referrals subsystem.
    @Optional() private readonly referrals?: ReferralsService,
  ) {}

  /**
   * Read the current KYC state, lazily creating the row on first
   * access (so the user-facing `/me/kyc` page doesn't blow up before
   * the user has uploaded anything).
   */
  async getStatus(userId: string): Promise<KycStateView> {
    const kyc = await this.ensureRow(userId);
    const documents = await this.prisma.kycDocument.findMany({
      where: { kycId: kyc.id },
      orderBy: { createdAt: 'desc' },
    });
    const tierMax = await this.maxWithdrawalForTier(kyc.tier);
    return {
      tier: kyc.tier,
      reviewState: kyc.reviewState,
      emailVerifiedAt: kyc.emailVerifiedAt,
      phoneVerifiedAt: kyc.phoneVerifiedAt,
      identityVerifiedAt: kyc.identityVerifiedAt,
      addressVerifiedAt: kyc.addressVerifiedAt,
      reviewNotes: kyc.reviewNotes,
      documents: documents.map((d) => ({
        id: d.id,
        kind: d.kind,
        reviewState: d.reviewState,
        virusScanStatus: d.virusScanStatus,
        createdAt: d.createdAt,
      })),
      maxWithdrawalCoins: tierMax,
    };
  }

  /**
   * Submit a document. Scans + encrypts + stores + creates a row.
   * Throws `BadRequestException` for any user-recoverable error
   * (wrong mime, too big, infected); throws `ConflictException` if
   * the user already has an APPROVED doc of the same kind (they
   * should rejecting + reuploading via /me/kyc instead).
   */
  async submitDocument(input: {
    userId: string;
    kind: DocumentKind;
    mimeType: string;
    payload: Buffer;
  }): Promise<{ documentId: string; reviewState: ReviewState; tier: KycTier }> {
    if (input.payload.length === 0) {
      throw new BadRequestException({ code: 'KYC_EMPTY_DOCUMENT' });
    }
    if (input.payload.length > KycService.MAX_DOCUMENT_BYTES) {
      throw new BadRequestException({ code: 'KYC_DOCUMENT_TOO_LARGE' });
    }
    const allow = KycService.MIME_ALLOWLIST[input.kind];
    if (!allow.includes(input.mimeType)) {
      throw new BadRequestException({
        code: 'KYC_DISALLOWED_MIME',
        kind: input.kind,
        mime: input.mimeType,
        allowed: allow,
      });
    }

    const kyc = await this.ensureRow(input.userId);

    // Refuse re-upload when a doc of the same kind is already
    // APPROVED — the user has nothing to gain and we'd be wasting a
    // reviewer's attention.
    const existingApproved = await this.prisma.kycDocument.findFirst({
      where: { kycId: kyc.id, kind: input.kind, reviewState: ReviewState.APPROVED },
    });
    if (existingApproved) {
      throw new ConflictException({
        code: 'KYC_DOCUMENT_ALREADY_APPROVED',
        kind: input.kind,
      });
    }

    // 1) Scan the plaintext. Encrypting first defeats signature
    // matching — scanner runs on raw bytes.
    const scan = await this.scanner.scan(input.payload);
    if (scan.status === ScanStatus.INFECTED) {
      // Audit so the security team sees patterns (one infected
      // upload is a curious user; ten from the same IP is an
      // attack to investigate).
      await this.audit.record({
        actorId: input.userId,
        actorEmail: '',
        action: 'kyc.document_infected',
        targetType: 'KycVerification',
        targetId: kyc.id,
        after: { kind: input.kind, signature: scan.signature ?? null },
      });
      throw new BadRequestException({
        code: 'KYC_INFECTED_DOCUMENT',
        signature: scan.signature,
      });
    }
    if (scan.status === ScanStatus.ERROR) {
      // Don't block on a scanner outage — mark PENDING and let the
      // admin queue re-run the scan during review.
      this.logger.warn(`virus scanner returned ERROR: ${scan.error}`);
    }

    // 2) Encrypt with the document cipher.
    const { ciphertext, keyVersion } = await this.cipher.encrypt(input.payload);

    // 3) Persist ciphertext, then write the row pointing at the
    // storage key. Store-before-row ordering means an aborted insert
    // leaves an orphan blob (cheap), not a dangling row (visible to
    // admin queue with a broken link).
    const fileKey = await this.storage.put({
      userId: input.userId,
      ciphertext,
      mimeType: input.mimeType,
    });

    const doc = await this.prisma.kycDocument.create({
      data: {
        kycId: kyc.id,
        kind: input.kind,
        fileKey,
        fileSizeBytes: input.payload.length,
        mimeType: input.mimeType,
        virusScanStatus: scan.status,
        encryptionKeyVersion: keyVersion,
        reviewState: ReviewState.PENDING,
      },
    });

    await this.audit.record({
      actorId: input.userId,
      actorEmail: '',
      action: 'kyc.document_submitted',
      targetType: 'KycDocument',
      targetId: doc.id,
      after: { kind: input.kind, fileSizeBytes: input.payload.length },
    });

    // Try an auto-promotion. For Tier 1 → Tier 2 we need an
    // APPROVED PAN/passport, so this typically doesn't move the
    // needle on submit (it moves on admin approval). But for the
    // email/phone case where verification happens elsewhere and
    // hits `markEmailVerified` / `markPhoneVerified`, we still
    // call it from those paths.
    await this.recomputeTier(input.userId);

    const after = await this.prisma.kycVerification.findUnique({ where: { userId: input.userId } });
    return { documentId: doc.id, reviewState: doc.reviewState, tier: after!.tier };
  }

  /**
   * Mark email verified — called from the email-change confirmation
   * flow (PR-EMAIL-1) and from the post-signup verification path.
   * Idempotent; bumps tier if appropriate.
   */
  async markEmailVerified(userId: string): Promise<KycVerification> {
    const kyc = await this.ensureRow(userId);
    if (kyc.emailVerifiedAt) return kyc;
    await this.prisma.kycVerification.update({
      where: { userId },
      data: { emailVerifiedAt: new Date() },
    });
    return this.recomputeTier(userId);
  }

  async markPhoneVerified(userId: string): Promise<KycVerification> {
    const kyc = await this.ensureRow(userId);
    if (kyc.phoneVerifiedAt) return kyc;
    await this.prisma.kycVerification.update({
      where: { userId },
      data: { phoneVerifiedAt: new Date() },
    });
    return this.recomputeTier(userId);
  }

  /**
   * Withdrawal eligibility — called by Bet's wallet service before
   * issuing a withdrawal. Returns the maximum coin amount allowed
   * per the user's current tier; `null` means "unlimited" (Tier 3).
   *
   * Coupled with `coins.tier_floor` setting (default `TIER_1`) which
   * is the *minimum* tier required to withdraw at all. Below that we
   * return 0 so the wallet refuses cleanly.
   */
  async withdrawalEligibility(userId: string): Promise<{
    tier: KycTier;
    maxCoins: number | null;
    blocked: boolean;
    reason?: string;
  }> {
    const kyc = await this.ensureRow(userId);
    const floor = await this.settings.getString('kyc.tier_floor', 'TIER_1');
    if (KycService.tierRank(kyc.tier) < KycService.tierRank(floor as KycTier)) {
      return {
        tier: kyc.tier,
        maxCoins: 0,
        blocked: true,
        reason: `kyc_below_${floor.toLowerCase()}`,
      };
    }
    const maxCoins = await this.maxWithdrawalForTier(kyc.tier);
    return {
      tier: kyc.tier,
      maxCoins,
      blocked: maxCoins === 0,
      reason: maxCoins === 0 ? 'kyc_blocked' : undefined,
    };
  }

  /**
   * Idempotent row insert. Race condition between two concurrent
   * `/me/kyc` reads is harmless: the table has a unique on userId so
   * the second insert short-circuits to `findUnique`.
   */
  private async ensureRow(userId: string): Promise<KycVerification> {
    const existing = await this.prisma.kycVerification.findUnique({ where: { userId } });
    if (existing) return existing;
    try {
      return await this.prisma.kycVerification.create({
        data: { userId, tier: KycTier.TIER_0 },
      });
    } catch (err: unknown) {
      // P2002 — unique violation, lost the race. Re-read.
      if (isUniqueViolation(err)) {
        const refetch = await this.prisma.kycVerification.findUnique({ where: { userId } });
        if (refetch) return refetch;
      }
      throw err;
    }
  }

  /**
   * Single source of truth for tier transitions. Idempotent —
   * re-running on an already-up-to-date row is a no-op.
   *
   * Promotion rules:
   *   - TIER_1 ← email+phone verified
   *   - TIER_2 ← TIER_1 + at least one APPROVED identity doc
   *   - TIER_3 ← TIER_2 + APPROVED address proof + APPROVED selfie
   *
   * We *do not* demote here. Demotion is a separate concern (admin
   * action — KYC-2) so a transient document rejection doesn't
   * accidentally lock a user out.
   */
  async recomputeTier(userId: string): Promise<KycVerification> {
    const kyc = await this.ensureRow(userId);
    const docs = await this.prisma.kycDocument.findMany({
      where: { kycId: kyc.id, reviewState: ReviewState.APPROVED },
      select: { kind: true },
    });
    const have = new Set(docs.map((d) => d.kind));

    const target = computeTier({
      emailVerified: kyc.emailVerifiedAt !== null,
      phoneVerified: kyc.phoneVerifiedAt !== null,
      hasIdentity:
        have.has(DocumentKind.PAN) ||
        have.has(DocumentKind.PASSPORT) ||
        have.has(DocumentKind.VOTER_ID),
      hasAddressProof: have.has(DocumentKind.ADDRESS_PROOF),
      hasSelfie: have.has(DocumentKind.SELFIE),
    });
    if (target === kyc.tier) return kyc;
    if (KycService.tierRank(target) < KycService.tierRank(kyc.tier)) {
      // Never auto-demote.
      return kyc;
    }
    const updates: Partial<KycVerification> = { tier: target };
    if (target >= KycTier.TIER_2 && !kyc.identityVerifiedAt) {
      updates.identityVerifiedAt = new Date();
    }
    if (target >= KycTier.TIER_3 && !kyc.addressVerifiedAt) {
      updates.addressVerifiedAt = new Date();
    }
    const updated = await this.prisma.kycVerification.update({
      where: { userId },
      data: updates,
    });
    await this.audit.record({
      actorId: userId,
      actorEmail: '',
      action: 'kyc.tier_promoted',
      targetType: 'KycVerification',
      targetId: kyc.id,
      before: { tier: kyc.tier },
      after: { tier: target },
    });

    // A promotion to TIER_1+ trips the KYC half of the referral
    // qualification gate. Fire `maybeQualify` best-effort — it re-reads
    // both gates and no-ops unless the deposit gate is also met, and it
    // must never break KYC promotion if the referrals subsystem hiccups.
    if (this.referrals && target !== KycTier.TIER_0) {
      void this.referrals.maybeQualify(userId).catch((err) => {
        this.logger.warn(
          `referral maybeQualify after KYC promotion failed for ${userId}: ${
            (err as Error).message
          }`,
        );
      });
    }

    return updated;
  }

  private async maxWithdrawalForTier(tier: KycTier): Promise<number | null> {
    const settingKey = `kyc.${tier.toLowerCase()}_max_withdrawal_coins`;
    const num = await this.settings.getInt(settingKey, 0);
    if (num === -1) return null; // unlimited
    return Math.max(0, num);
  }

  static tierRank(tier: KycTier): number {
    return { TIER_0: 0, TIER_1: 1, TIER_2: 2, TIER_3: 3 }[tier];
  }

  // ─── Admin queue (PR-KYC-2) ─────────────────────────────────────

  /**
   * Paginated list of documents pending admin review. Filterable by
   * doc kind. Cursor-based — same pattern as `/admin/audit`.
   */
  async listForReview(input: {
    kind?: DocumentKind;
    cursor?: string;
    limit?: number;
    state?: ReviewState;
  }): Promise<{ items: AdminQueueRow[]; nextCursor: string | null }> {
    const take = clampPageLimit(input.limit);
    const docs = await this.prisma.kycDocument.findMany({
      where: {
        ...(input.kind ? { kind: input.kind } : {}),
        reviewState: input.state ?? ReviewState.PENDING,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: take + 1,
      ...(input.cursor ? { skip: 1, cursor: { id: input.cursor } } : {}),
      include: {
        kyc: { select: { userId: true, tier: true, user: { select: { username: true, email: true } } } },
      },
    });
    const { page, nextCursor } = cursorPage(docs, take);
    const items: AdminQueueRow[] = page.map((d) => ({
      documentId: d.id,
      userId: d.kyc.userId,
      username: d.kyc.user.username,
      email: d.kyc.user.email,
      currentTier: d.kyc.tier,
      kind: d.kind,
      virusScanStatus: d.virusScanStatus,
      reviewState: d.reviewState,
      fileSizeBytes: d.fileSizeBytes,
      mimeType: d.mimeType,
      submittedAt: d.createdAt,
    }));
    return { items, nextCursor };
  }

  /**
   * Approve a document. Bumps the user's tier if this unlocks the
   * next rung (recomputeTier). Idempotent on already-APPROVED docs.
   */
  async approve(input: {
    reviewer: { id: string; email: string };
    documentId: string;
    notes?: string;
  }): Promise<{ documentId: string; reviewState: ReviewState; newTier: KycTier }> {
    const doc = await this.requireDoc(input.documentId);
    if (doc.reviewState === ReviewState.APPROVED) {
      const kyc = await this.prisma.kycVerification.findUnique({ where: { id: doc.kycId } });
      return { documentId: doc.id, reviewState: ReviewState.APPROVED, newTier: kyc!.tier };
    }
    await this.prisma.kycDocument.update({
      where: { id: input.documentId },
      data: {
        reviewState: ReviewState.APPROVED,
        reviewerId: input.reviewer.id,
        reviewNotes: input.notes ?? null,
      },
    });
    await this.audit.record({
      actorId: input.reviewer.id,
      actorEmail: input.reviewer.email,
      action: 'kyc.document_approved',
      targetType: 'KycDocument',
      targetId: input.documentId,
      before: { reviewState: doc.reviewState },
      after: { reviewState: ReviewState.APPROVED, notes: input.notes ?? null },
    });
    const kyc = await this.prisma.kycVerification.findUnique({ where: { id: doc.kycId } });
    const updated = await this.recomputeTier(kyc!.userId);
    return { documentId: doc.id, reviewState: ReviewState.APPROVED, newTier: updated.tier };
  }

  /**
   * Reject a document. Sets the row to REJECTED. The user has to
   * upload a fresh doc to retry — re-using a rejected key would
   * defeat the audit trail.
   */
  async reject(input: {
    reviewer: { id: string; email: string };
    documentId: string;
    notes: string;
  }): Promise<{ documentId: string; reviewState: ReviewState }> {
    if (input.notes.trim().length < 4) {
      throw new BadRequestException({ code: 'KYC_REJECT_NOTES_REQUIRED' });
    }
    const doc = await this.requireDoc(input.documentId);
    await this.prisma.kycDocument.update({
      where: { id: input.documentId },
      data: {
        reviewState: ReviewState.REJECTED,
        reviewerId: input.reviewer.id,
        reviewNotes: input.notes,
      },
    });
    await this.audit.record({
      actorId: input.reviewer.id,
      actorEmail: input.reviewer.email,
      action: 'kyc.document_rejected',
      targetType: 'KycDocument',
      targetId: input.documentId,
      before: { reviewState: doc.reviewState },
      after: { reviewState: ReviewState.REJECTED, notes: input.notes },
    });
    return { documentId: doc.id, reviewState: ReviewState.REJECTED };
  }

  /**
   * Soft-reject: ask for a clearer/different submission without
   * burning the user's slot. Distinct from REJECTED so analytics can
   * tell genuine fraud rejections from "photo was blurry" prompts.
   */
  async requestResubmit(input: {
    reviewer: { id: string; email: string };
    documentId: string;
    notes: string;
  }): Promise<{ documentId: string; reviewState: ReviewState }> {
    if (input.notes.trim().length < 4) {
      throw new BadRequestException({ code: 'KYC_RESUBMIT_NOTES_REQUIRED' });
    }
    const doc = await this.requireDoc(input.documentId);
    await this.prisma.kycDocument.update({
      where: { id: input.documentId },
      data: {
        reviewState: ReviewState.REQUIRES_RESUBMIT,
        reviewerId: input.reviewer.id,
        reviewNotes: input.notes,
      },
    });
    await this.audit.record({
      actorId: input.reviewer.id,
      actorEmail: input.reviewer.email,
      action: 'kyc.document_resubmit_requested',
      targetType: 'KycDocument',
      targetId: input.documentId,
      before: { reviewState: doc.reviewState },
      after: { reviewState: ReviewState.REQUIRES_RESUBMIT, notes: input.notes },
    });
    return { documentId: doc.id, reviewState: ReviewState.REQUIRES_RESUBMIT };
  }

  /**
   * Stream the decrypted document bytes for an admin reviewer.
   * **Audited on every read** — we treat each look at sensitive PII
   * as a deliberate access event for the compliance audit trail.
   */
  async readDocument(input: {
    reviewer: { id: string; email: string };
    documentId: string;
  }): Promise<{ mimeType: string; bytes: Buffer; kind: DocumentKind }> {
    const doc = await this.requireDoc(input.documentId);
    const ciphertext = await this.storage.get(doc.fileKey);
    const bytes = await this.cipher.decrypt(ciphertext, doc.encryptionKeyVersion);
    await this.audit.record({
      actorId: input.reviewer.id,
      actorEmail: input.reviewer.email,
      action: 'kyc.document_viewed',
      targetType: 'KycDocument',
      targetId: input.documentId,
      after: { kind: doc.kind, sizeBytes: doc.fileSizeBytes },
    });
    return { mimeType: doc.mimeType, bytes, kind: doc.kind };
  }

  private async requireDoc(id: string) {
    const doc = await this.prisma.kycDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException({ code: 'KYC_DOCUMENT_NOT_FOUND' });
    return doc;
  }
}

export interface AdminQueueRow {
  documentId: string;
  userId: string;
  username: string;
  email: string | null;
  currentTier: KycTier;
  kind: DocumentKind;
  virusScanStatus: ScanStatus;
  reviewState: ReviewState;
  fileSizeBytes: number;
  mimeType: string;
  submittedAt: Date;
}

/** Pure tier transition function — extracted so tests can hit it
 * without spinning up the whole service. */
export function computeTier(have: {
  emailVerified: boolean;
  phoneVerified: boolean;
  hasIdentity: boolean;
  hasAddressProof: boolean;
  hasSelfie: boolean;
}): KycTier {
  if (have.emailVerified && have.phoneVerified && have.hasIdentity && have.hasAddressProof && have.hasSelfie) {
    return KycTier.TIER_3;
  }
  if (have.emailVerified && have.phoneVerified && have.hasIdentity) {
    return KycTier.TIER_2;
  }
  if (have.emailVerified && have.phoneVerified) {
    return KycTier.TIER_1;
  }
  return KycTier.TIER_0;
}

export interface KycStateView {
  tier: KycTier;
  reviewState: ReviewState;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  identityVerifiedAt: Date | null;
  addressVerifiedAt: Date | null;
  reviewNotes: string | null;
  documents: Array<{
    id: string;
    kind: DocumentKind;
    reviewState: ReviewState;
    virusScanStatus: ScanStatus;
    createdAt: Date;
  }>;
  maxWithdrawalCoins: number | null;
}
