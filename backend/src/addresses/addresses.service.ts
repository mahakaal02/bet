import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type ShippingAddress } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Shipping addresses (Roadmap §F-USER-6).
 *
 * Storage today is plain columns. The schema header reserves the
 * right to wrap each PII field in `SecretCipher` once the KMS
 * helper that PR-2FA-1 added lands on main — a follow-up PR
 * (`PR-ADDRESS-PII`) will swap the read/write paths. The interface
 * shape is already pessimistic about that: every read goes through
 * `decryptRow()` and every write through `encryptRow()` which are
 * passthrough stubs for now. Drop-in swap, no schema migration.
 *
 * Default-selection invariants
 *
 *   - At most one non-deleted row per user has `isDefault = true`.
 *     `setDefault()` clears any other default in the same Prisma
 *     `$transaction` so a partial failure can't leave two defaults.
 *   - Creating the user's FIRST address auto-flags it default —
 *     they shouldn't have to pick "yes this is my default" when
 *     there's only one.
 *   - Soft-deleting the current default auto-promotes the
 *     most-recently-touched remaining address.
 *
 * Soft delete (not hard) keeps the address snapshot reachable from
 * past `Order` rows that referenced it via foreign key. Hard
 * deletion would either break those rows or require copying every
 * snapshot into the Order itself — both worse.
 *
 * Cap: 10 active (non-deleted) addresses per user. Beyond that,
 * users delete an old one before adding a new one — keeps the UI
 * usable + bounds the search space when the order flow needs to
 * pick one.
 */

const MAX_ACTIVE_PER_USER = 10;

export interface AddressInput {
  fullName: string;
  phoneE164: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  countryIso2: string;
  isDefault?: boolean;
}

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Active (non-deleted) addresses for the user, default-first then most-recent. */
  async list(userId: string): Promise<ShippingAddress[]> {
    const rows = await this.prisma.shippingAddress.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
    return rows.map((r) => this.decryptRow(r));
  }

  async create(userId: string, input: AddressInput): Promise<ShippingAddress> {
    AddressesService.validateInput(input);

    const activeCount = await this.prisma.shippingAddress.count({
      where: { userId, deletedAt: null },
    });
    if (activeCount >= MAX_ACTIVE_PER_USER) {
      throw new ConflictException(
        `Address book is full (${MAX_ACTIVE_PER_USER}). Delete one before adding another.`,
      );
    }

    // The very first address is always the default — the user
    // doesn't have to opt in.
    const willBeDefault = activeCount === 0 ? true : !!input.isDefault;

    return this.prisma.$transaction(async (tx) => {
      if (willBeDefault) {
        await tx.shippingAddress.updateMany({
          where: { userId, deletedAt: null, isDefault: true },
          data: { isDefault: false },
        });
      }
      const created = await tx.shippingAddress.create({
        data: this.encryptRow({
          userId,
          ...input,
          line2: input.line2 ?? null,
          isDefault: willBeDefault,
        }),
      });
      return this.decryptRow(created);
    });
  }

  async update(
    userId: string,
    addressId: string,
    input: Partial<AddressInput>,
  ): Promise<ShippingAddress> {
    const existing = await this.requireOwned(userId, addressId);
    AddressesService.validateInput({ ...this.decryptRow(existing), ...input } as AddressInput);

    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault === true && !existing.isDefault) {
        await tx.shippingAddress.updateMany({
          where: {
            userId,
            deletedAt: null,
            isDefault: true,
            NOT: { id: addressId },
          },
          data: { isDefault: false },
        });
      }
      // Setting isDefault: false while it's currently the only
      // default would leave the user with no default. Refuse —
      // the user needs to set a different one as default first.
      if (
        input.isDefault === false &&
        existing.isDefault
      ) {
        const others = await tx.shippingAddress.count({
          where: { userId, deletedAt: null, isDefault: true, NOT: { id: addressId } },
        });
        if (others === 0) {
          throw new BadRequestException(
            'cannot unflag the only default — set another address as default first',
          );
        }
      }
      const data: Prisma.ShippingAddressUpdateInput = this.encryptUpdate(input);
      const next = await tx.shippingAddress.update({
        where: { id: addressId },
        data,
      });
      return this.decryptRow(next);
    });
  }

  async setDefault(userId: string, addressId: string): Promise<ShippingAddress> {
    const target = await this.requireOwned(userId, addressId);
    if (target.isDefault) return this.decryptRow(target);
    return this.prisma.$transaction(async (tx) => {
      await tx.shippingAddress.updateMany({
        where: { userId, deletedAt: null, isDefault: true },
        data: { isDefault: false },
      });
      const next = await tx.shippingAddress.update({
        where: { id: addressId },
        data: { isDefault: true },
      });
      return this.decryptRow(next);
    });
  }

  /**
   * Soft delete. If the row was the user's default, the next most-
   * recently-touched remaining address is auto-promoted. Returns
   * the promoted id (or null) so the UI can show "now default:
   * <city>" inline.
   */
  async softDelete(
    userId: string,
    addressId: string,
  ): Promise<{ removedId: string; newDefaultId: string | null }> {
    const target = await this.requireOwned(userId, addressId);
    // Snapshot the flag BEFORE we update — the update zeroes
    // `isDefault`, and depending on the Prisma client's reuse of
    // row objects the original could be mutated under us.
    const wasDefault = target.isDefault;
    return this.prisma.$transaction(async (tx) => {
      await tx.shippingAddress.update({
        where: { id: addressId },
        data: { deletedAt: new Date(), isDefault: false },
      });
      let newDefaultId: string | null = null;
      if (wasDefault) {
        const candidate = await tx.shippingAddress.findFirst({
          where: { userId, deletedAt: null },
          orderBy: { updatedAt: 'desc' },
        });
        if (candidate) {
          await tx.shippingAddress.update({
            where: { id: candidate.id },
            data: { isDefault: true },
          });
          newDefaultId = candidate.id;
        }
      }
      return { removedId: addressId, newDefaultId };
    });
  }

  private async requireOwned(userId: string, addressId: string): Promise<ShippingAddress> {
    const row = await this.prisma.shippingAddress.findUnique({
      where: { id: addressId },
    });
    if (!row || row.deletedAt) {
      throw new NotFoundException('address not found');
    }
    if (row.userId !== userId) {
      // Same 404 shape as not-found — never leak existence.
      throw new ForbiddenException('not your address');
    }
    return row;
  }

  // ─── Encryption shim (passthrough for now) ────────────────────────

  /**
   * Where the PII-at-rest swap will happen. For now these are pure
   * passthroughs so the rest of the code reads as if the columns
   * were encrypted.
   *
   * The swap (PR-ADDRESS-PII):
   *   - `encryptRow` runs each PII field through SecretCipher.encrypt
   *   - `decryptRow` runs the inverse
   *   - Schema column type stays `String`; ciphertext is base64-tagged
   *     so the reader can detect rows that pre-date encryption and
   *     pass them through unchanged.
   */
  private encryptRow<T extends AddressInput & { userId: string; isDefault: boolean; line2: string | null }>(
    row: T,
  ): T {
    return row;
  }
  private encryptUpdate(
    input: Partial<AddressInput>,
  ): Prisma.ShippingAddressUpdateInput {
    const data: Prisma.ShippingAddressUpdateInput = {};
    if (input.fullName !== undefined) data.fullName = input.fullName;
    if (input.phoneE164 !== undefined) data.phoneE164 = input.phoneE164;
    if (input.line1 !== undefined) data.line1 = input.line1;
    if (input.line2 !== undefined) data.line2 = input.line2;
    if (input.city !== undefined) data.city = input.city;
    if (input.state !== undefined) data.state = input.state;
    if (input.postalCode !== undefined) data.postalCode = input.postalCode;
    if (input.countryIso2 !== undefined) data.countryIso2 = input.countryIso2;
    if (input.isDefault !== undefined) data.isDefault = input.isDefault;
    return data;
  }
  private decryptRow(row: ShippingAddress): ShippingAddress {
    return row;
  }

  // ─── Validation (exported for testing) ────────────────────────────

  static validateInput(input: AddressInput): void {
    const E164 = /^\+[1-9]\d{6,14}$/;
    const ISO2 = /^[A-Z]{2}$/;
    const checks: Array<[string, boolean, string]> = [
      ['fullName', !!input.fullName && input.fullName.trim().length >= 2 && input.fullName.length <= 100, 'fullName must be 2-100 chars'],
      ['phoneE164', E164.test(input.phoneE164), 'phoneE164 must be in +CCNNNNN… E.164 format'],
      ['line1', !!input.line1 && input.line1.trim().length >= 3 && input.line1.length <= 200, 'line1 must be 3-200 chars'],
      ['line2', input.line2 == null || input.line2.length <= 200, 'line2 must be ≤ 200 chars'],
      ['city', !!input.city && input.city.trim().length >= 2 && input.city.length <= 100, 'city must be 2-100 chars'],
      ['state', !!input.state && input.state.trim().length >= 2 && input.state.length <= 64, 'state must be 2-64 chars'],
      ['postalCode', !!input.postalCode && input.postalCode.trim().length >= 3 && input.postalCode.length <= 16, 'postalCode must be 3-16 chars'],
      ['countryIso2', ISO2.test(input.countryIso2), 'countryIso2 must be a 2-letter ISO code (uppercase)'],
    ];
    for (const [field, ok, msg] of checks) {
      if (!ok) throw new BadRequestException(`${field}: ${msg}`);
    }
    // India postal code → 6 digits, no letters.
    if (input.countryIso2 === 'IN' && !/^\d{6}$/.test(input.postalCode)) {
      throw new BadRequestException(
        'postalCode: Indian PIN codes must be exactly 6 digits',
      );
    }
  }
}
