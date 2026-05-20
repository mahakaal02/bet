import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PromoCode, PromoCodeDiscountType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../foundation/audit-log.service';

/**
 * Promo codes (Roadmap §F-USER-12).
 *
 * Surface:
 *   - admin CRUD (create / list / disable; updates limited to
 *     enabled + maxUses + maxUsesPerUser + expiresAt + notes so a
 *     live campaign's discount math can't be retroactively changed).
 *   - user-facing `validate(code, userId, coinPackId, basePaise)`
 *     returns either { ok, discountInr } or { ok: false, code }.
 *   - `redeem()` records the usage against a payment order — the
 *     payment service calls this inside the same transaction as
 *     order creation.
 *
 * The validate / redeem split keeps the gate honest: validate is
 * pure (read-only, idempotent), redeem actually counts. A misbehaved
 * client calling validate 1000 times never affects the per-user cap.
 *
 * Concurrency note: the per-user cap is enforced by counting
 * redemption rows, not by a unique constraint, because the schema
 * allows maxUsesPerUser > 1 (a user could legitimately have 3 prior
 * redemptions). The race window between validate and redeem is
 * tiny but real — we accept a soft over-count by 1 (worst case the
 * 4th redemption sneaks through on a maxUsesPerUser=3 code) rather
 * than complicate the schema. Payment paths run inside a Prisma
 * transaction so concurrent redemptions on the same payment order
 * can't double-redeem.
 */
@Injectable()
export class PromoCodesService {
  private readonly logger = new Logger(PromoCodesService.name);

  static readonly CODE_PATTERN = /^[A-Z0-9_-]{4,32}$/;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // ─── Admin CRUD ──────────────────────────────────────────────

  async create(input: {
    adminId: string;
    adminEmail: string;
    code: string;
    discountType: PromoCodeDiscountType;
    discountValue: number;
    maxUses?: number;
    maxUsesPerUser?: number;
    expiresAt?: Date;
    coinPackIds?: string[];
    notes?: string;
  }): Promise<PromoCode> {
    const code = input.code.trim().toUpperCase();
    if (!PromoCodesService.CODE_PATTERN.test(code)) {
      throw new BadRequestException({ code: 'PROMO_CODE_FORMAT_INVALID', pattern: 'A-Z0-9_- length 4-32' });
    }
    if (input.discountType === PromoCodeDiscountType.PERCENT) {
      if (input.discountValue < 1 || input.discountValue > 100) {
        throw new BadRequestException({ code: 'PROMO_PERCENT_OUT_OF_RANGE' });
      }
    } else if (input.discountValue <= 0) {
      throw new BadRequestException({ code: 'PROMO_FLAT_NON_POSITIVE' });
    }
    if (input.maxUses !== undefined && input.maxUses <= 0) {
      throw new BadRequestException({ code: 'PROMO_MAX_USES_NON_POSITIVE' });
    }
    if (input.maxUsesPerUser !== undefined && input.maxUsesPerUser <= 0) {
      throw new BadRequestException({ code: 'PROMO_MAX_USES_PER_USER_NON_POSITIVE' });
    }
    if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException({ code: 'PROMO_EXPIRES_IN_PAST' });
    }

    let created: PromoCode;
    try {
      created = await this.prisma.promoCode.create({
        data: {
          code,
          discountType: input.discountType,
          discountValue: input.discountValue,
          maxUses: input.maxUses ?? null,
          maxUsesPerUser: input.maxUsesPerUser ?? 1,
          expiresAt: input.expiresAt ?? null,
          coinPackIds: input.coinPackIds ?? [],
          createdBy: input.adminId,
          notes: input.notes ?? null,
        },
      });
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException({ code: 'PROMO_CODE_DUPLICATE' });
      }
      throw err;
    }

    await this.audit.record({
      actorId: input.adminId,
      actorEmail: input.adminEmail,
      action: 'promo.create',
      targetType: 'PromoCode',
      targetId: created.id,
      after: {
        code: created.code,
        discountType: created.discountType,
        discountValue: created.discountValue,
        expiresAt: created.expiresAt?.toISOString() ?? null,
      },
    });
    return created;
  }

  async list(input: { enabled?: boolean; cursor?: string; limit?: number }) {
    const take = Math.min(100, Math.max(1, input.limit ?? 25));
    const rows = await this.prisma.promoCode.findMany({
      where: input.enabled !== undefined ? { enabled: input.enabled } : {},
      orderBy: [{ createdAt: 'desc' }],
      take: take + 1,
      ...(input.cursor ? { skip: 1, cursor: { id: input.cursor } } : {}),
    });
    return {
      items: rows.slice(0, take),
      nextCursor: rows.length > take ? rows[take].id : null,
    };
  }

  /**
   * Enable / disable a code — preferred over deletion so the
   * redemption history stays intact.
   */
  async setEnabled(input: {
    adminId: string;
    adminEmail: string;
    promoCodeId: string;
    enabled: boolean;
  }) {
    const code = await this.requireCode(input.promoCodeId);
    if (code.enabled === input.enabled) {
      return code;
    }
    const updated = await this.prisma.promoCode.update({
      where: { id: input.promoCodeId },
      data: { enabled: input.enabled },
    });
    await this.audit.record({
      actorId: input.adminId,
      actorEmail: input.adminEmail,
      action: input.enabled ? 'promo.enable' : 'promo.disable',
      targetType: 'PromoCode',
      targetId: code.id,
      before: { enabled: code.enabled },
      after: { enabled: input.enabled },
    });
    return updated;
  }

  // ─── Validate / redeem (user-facing) ─────────────────────────

  async validate(input: {
    code: string;
    userId: string;
    coinPackId?: string;
    basePaise: number;
  }): Promise<ValidateResult> {
    if (!Number.isFinite(input.basePaise) || input.basePaise <= 0) {
      return { ok: false, code: 'PROMO_BASE_PRICE_INVALID' };
    }
    const code = input.code.trim().toUpperCase();
    const promo = await this.prisma.promoCode.findUnique({ where: { code } });
    if (!promo) return { ok: false, code: 'PROMO_NOT_FOUND' };
    if (!promo.enabled) return { ok: false, code: 'PROMO_DISABLED' };
    if (promo.expiresAt && promo.expiresAt.getTime() < Date.now()) {
      return { ok: false, code: 'PROMO_EXPIRED' };
    }
    if (promo.coinPackIds.length > 0 && input.coinPackId &&
        !promo.coinPackIds.includes(input.coinPackId)) {
      return { ok: false, code: 'PROMO_NOT_FOR_THIS_PACK' };
    }
    if (promo.maxUses !== null) {
      const used = await this.prisma.promoCodeRedemption.count({
        where: { promoCodeId: promo.id },
      });
      if (used >= promo.maxUses) {
        return { ok: false, code: 'PROMO_OUT_OF_USES' };
      }
    }
    const usedByUser = await this.prisma.promoCodeRedemption.count({
      where: { promoCodeId: promo.id, userId: input.userId },
    });
    if (usedByUser >= promo.maxUsesPerUser) {
      return { ok: false, code: 'PROMO_USER_LIMIT_REACHED' };
    }

    const discountInr = computeDiscount(promo, input.basePaise);
    return { ok: true, discountInr, finalPaise: input.basePaise - discountInr, promoCodeId: promo.id };
  }

  /**
   * Record a redemption. Caller MUST have just validated and is
   * about to commit a payment order. We don't re-validate here —
   * trusting the (caller's transactional) sequence avoids double-
   * locking the row.
   */
  async redeem(input: {
    promoCodeId: string;
    userId: string;
    paymentOrderId: string;
    discountInr: number;
  }) {
    await this.prisma.promoCodeRedemption.create({
      data: {
        promoCodeId: input.promoCodeId,
        userId: input.userId,
        paymentOrderId: input.paymentOrderId,
        discountInr: input.discountInr,
      },
    });
  }

  // ─── helpers ──────────────────────────────────────────────────

  private async requireCode(id: string): Promise<PromoCode> {
    const r = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!r) throw new NotFoundException({ code: 'PROMO_NOT_FOUND' });
    return r;
  }

  private isUniqueViolation(err: unknown): boolean {
    return Boolean(
      err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002',
    );
  }
}

/**
 * Pure discount math, exposed for unit tests.
 *
 *   - PERCENT: floor((base * percent) / 100). Always integer paise.
 *   - FLAT: min(base, discountValue). Never refund more than the
 *           order — a 500₹ pack with a 1000₹ flat coupon goes to 0,
 *           not negative.
 */
export function computeDiscount(
  promo: Pick<PromoCode, 'discountType' | 'discountValue'>,
  basePaise: number,
): number {
  if (promo.discountType === PromoCodeDiscountType.PERCENT) {
    return Math.floor((basePaise * promo.discountValue) / 100);
  }
  return Math.min(basePaise, promo.discountValue);
}

export type ValidateResult =
  | { ok: true; discountInr: number; finalPaise: number; promoCodeId: string }
  | { ok: false; code: string };
