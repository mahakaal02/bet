import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Order, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../foundation/audit-log.service';

/**
 * Order lifecycle (Roadmap §F-USER-3).
 *
 * State machine — each transition is one-way and gated:
 *
 *   PENDING_ADDRESS       — order created on auction settle. Winner
 *                            must pick a shipping address before ops
 *                            can ship.
 *           ↓ setShippingAddress(user, addressId)
 *   AWAITING_FULFILLMENT  — address locked in (snapshotted so admin
 *                            edits to the source row don't change the
 *                            destination). Ops sees it in the queue.
 *           ↓ ship(admin, { carrier, tracking, url })
 *   IN_TRANSIT            — carrier accepted. Tracking link visible
 *                            to the user.
 *           ↓ markDelivered(admin, deliveredBy)
 *   DELIVERED             — terminal happy path. dispute() can still
 *                            transition out if the user reports an
 *                            issue.
 *
 * Off-path transitions:
 *   * → DISPUTED via dispute(user|admin, reason). Captures a reason
 *     + writes an AdminAuditLog row.
 *   * → CANCELLED via cancel(admin, reason). Admin-only — used when
 *     a duplicate / rigged auction's order needs to be wiped before
 *     fulfilment.
 *
 * Idempotency:
 *   - createForWin() is called from BidsService at settle time; it's
 *     guarded by the unique constraint on `Order.auctionId` so a
 *     replayed settle never double-creates.
 *   - Status writes are guarded by the expected-from check, so a
 *     replayed ship() / markDelivered() either no-ops or throws.
 *
 * Address snapshot:
 *   - When the user sets the shipping address, we copy the row into
 *     `Order.shippingAddressSnapshot` (JSON). Subsequent edits to
 *     the source `ShippingAddress` row do NOT change what ops ships
 *     to. Soft-deleting the source row also leaves the snapshot
 *     intact — orders survive address deletion.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // ─── User-side ─────────────────────────────────────────────────

  /**
   * Idempotent create. Called from BidsService.settleAuction (or the
   * future scheduler that closes ended auctions). Returns the row
   * whether freshly created or pre-existing.
   */
  async createForWin(input: {
    auctionId: string;
    winnerId: string;
  }): Promise<Order> {
    try {
      return await this.prisma.order.create({
        data: {
          auctionId: input.auctionId,
          winnerId: input.winnerId,
          status: OrderStatus.PENDING_ADDRESS,
        },
      });
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        const existing = await this.prisma.order.findUnique({
          where: { auctionId: input.auctionId },
        });
        if (existing) return existing;
      }
      throw err;
    }
  }

  /** List the calling user's orders, newest first. */
  async listMine(userId: string): Promise<OrderListItem[]> {
    const rows = await this.prisma.order.findMany({
      where: { winnerId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        auction: { select: { title: true, retailPrice: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      auctionTitle: r.auction.title,
      retailPrice: Number(r.auction.retailPrice),
      carrierName: r.carrierName,
      trackingNumber: r.trackingNumber,
      trackingUrl: r.trackingUrl,
      shippedAt: r.shippedAt,
      deliveredAt: r.deliveredAt,
      disputedAt: r.disputedAt,
      createdAt: r.createdAt,
    }));
  }

  /** Per-order detail — includes the address snapshot + dispute notes. */
  async getMine(userId: string, orderId: string): Promise<OrderDetailView> {
    const row = await this.requireOrderOwnedBy(userId, orderId);
    return {
      id: row.id,
      status: row.status,
      auctionId: row.auctionId,
      shippingAddressId: row.shippingAddressId,
      shippingAddressSnapshot: row.shippingAddressSnapshot,
      carrierName: row.carrierName,
      trackingNumber: row.trackingNumber,
      trackingUrl: row.trackingUrl,
      shippedAt: row.shippedAt,
      deliveredAt: row.deliveredAt,
      disputedAt: row.disputedAt,
      disputeReason: row.disputeReason,
      fulfillmentNotes: row.fulfillmentNotes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Bind a shipping address to a PENDING_ADDRESS order. Validates:
   *   1. Order is in PENDING_ADDRESS.
   *   2. Address belongs to the calling user (no spoofing).
   *   3. Address isn't soft-deleted.
   *
   * Snapshots the full address row at this moment — subsequent edits
   * to the source row are decoupled from what ops ships to.
   */
  async setShippingAddress(input: {
    userId: string;
    orderId: string;
    addressId: string;
  }): Promise<{ orderId: string; status: OrderStatus }> {
    const order = await this.requireOrderOwnedBy(input.userId, input.orderId);
    if (order.status !== OrderStatus.PENDING_ADDRESS) {
      throw new ConflictException({
        code: 'ORDER_STATUS_INVALID',
        message: 'Address can only be set while the order is awaiting one.',
      });
    }
    const addr = await this.prisma.shippingAddress.findFirst({
      where: { id: input.addressId, userId: input.userId, deletedAt: null },
    });
    if (!addr) {
      throw new BadRequestException({ code: 'ADDRESS_NOT_FOUND_OR_DELETED' });
    }

    const snapshot = {
      fullName: addr.fullName,
      phoneE164: addr.phoneE164,
      line1: addr.line1,
      line2: addr.line2,
      city: addr.city,
      state: addr.state,
      postalCode: addr.postalCode,
      countryIso2: addr.countryIso2,
      capturedAt: new Date().toISOString(),
    };

    const updated = await this.prisma.order.update({
      where: { id: input.orderId },
      data: {
        shippingAddressId: input.addressId,
        shippingAddressSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        status: OrderStatus.AWAITING_FULFILLMENT,
      },
    });
    return { orderId: updated.id, status: updated.status };
  }

  /**
   * User-side dispute. Allowed from IN_TRANSIT or DELIVERED — once
   * fulfilment has started, the user can say "wrong item / didn't
   * arrive / damaged". Admin tooling consumes the disputeReason.
   */
  async dispute(input: {
    userId: string;
    orderId: string;
    reason: string;
  }): Promise<{ orderId: string; status: OrderStatus }> {
    if (input.reason.trim().length < 10) {
      throw new BadRequestException({ code: 'DISPUTE_REASON_TOO_SHORT' });
    }
    const order = await this.requireOrderOwnedBy(input.userId, input.orderId);
    if (
      order.status !== OrderStatus.IN_TRANSIT &&
      order.status !== OrderStatus.DELIVERED
    ) {
      throw new ConflictException({
        code: 'ORDER_DISPUTE_NOT_ALLOWED',
        message:
          'Disputes can only be opened on orders that are in transit or delivered.',
      });
    }
    const updated = await this.prisma.order.update({
      where: { id: input.orderId },
      data: {
        status: OrderStatus.DISPUTED,
        disputedAt: new Date(),
        disputeReason: input.reason.trim(),
      },
    });
    await this.audit.record({
      actorId: input.userId,
      actorEmail: '',
      action: 'order.dispute_opened',
      targetType: 'Order',
      targetId: input.orderId,
      before: { status: order.status },
      after: { status: OrderStatus.DISPUTED, reason: input.reason.trim() },
    });
    return { orderId: updated.id, status: updated.status };
  }

  // ─── Admin-side ────────────────────────────────────────────────

  /**
   * Admin queue — orders awaiting ops action. Default filter is
   * AWAITING_FULFILLMENT (the active workload); cursor pagination.
   */
  async listForAdmin(input: {
    status?: OrderStatus;
    cursor?: string;
    limit?: number;
  }): Promise<{ items: AdminOrderRow[]; nextCursor: string | null }> {
    const take = Math.min(50, Math.max(1, input.limit ?? 25));
    const rows = await this.prisma.order.findMany({
      where: input.status ? { status: input.status } : {},
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(input.cursor ? { skip: 1, cursor: { id: input.cursor } } : {}),
      include: {
        auction: { select: { title: true, retailPrice: true } },
      },
    });
    const items = rows.slice(0, take).map((r) => ({
      id: r.id,
      status: r.status,
      winnerId: r.winnerId,
      auctionId: r.auctionId,
      auctionTitle: r.auction.title,
      retailPrice: Number(r.auction.retailPrice),
      hasAddress: r.shippingAddressId !== null,
      carrierName: r.carrierName,
      trackingNumber: r.trackingNumber,
      shippedAt: r.shippedAt,
      deliveredAt: r.deliveredAt,
      disputedAt: r.disputedAt,
      updatedAt: r.updatedAt,
    }));
    const nextCursor = rows.length > take ? rows[take].id : null;
    return { items, nextCursor };
  }

  /**
   * Ops marks the order shipped. Requires the user to have set an
   * address (status = AWAITING_FULFILLMENT). Tracking URL is
   * optional — some carriers don't expose a public URL.
   */
  async ship(input: {
    adminId: string;
    adminEmail: string;
    orderId: string;
    carrierName: string;
    trackingNumber: string;
    trackingUrl?: string;
    notes?: string;
  }): Promise<{ orderId: string; status: OrderStatus }> {
    if (!input.carrierName.trim() || !input.trackingNumber.trim()) {
      throw new BadRequestException({ code: 'CARRIER_AND_TRACKING_REQUIRED' });
    }
    const order = await this.requireOrder(input.orderId);
    if (order.status !== OrderStatus.AWAITING_FULFILLMENT) {
      throw new ConflictException({
        code: 'ORDER_STATUS_INVALID',
        message: 'Ship action requires the order to be awaiting fulfilment.',
      });
    }
    const updated = await this.prisma.order.update({
      where: { id: input.orderId },
      data: {
        status: OrderStatus.IN_TRANSIT,
        carrierName: input.carrierName.trim(),
        trackingNumber: input.trackingNumber.trim(),
        trackingUrl: input.trackingUrl?.trim() ?? null,
        fulfillmentNotes: input.notes?.trim() ?? null,
        shippedAt: new Date(),
      },
    });
    await this.audit.record({
      actorId: input.adminId,
      actorEmail: input.adminEmail,
      action: 'order.shipped',
      targetType: 'Order',
      targetId: input.orderId,
      before: { status: order.status },
      after: {
        status: OrderStatus.IN_TRANSIT,
        carrier: input.carrierName,
        tracking: input.trackingNumber,
      },
    });
    return { orderId: updated.id, status: updated.status };
  }

  /**
   * Ops confirms delivery. Allowed from IN_TRANSIT. `deliveredBy` is
   * a free-text field for the courier signature / proof note.
   */
  async markDelivered(input: {
    adminId: string;
    adminEmail: string;
    orderId: string;
    deliveredBy?: string;
  }): Promise<{ orderId: string; status: OrderStatus }> {
    const order = await this.requireOrder(input.orderId);
    if (order.status !== OrderStatus.IN_TRANSIT) {
      throw new ConflictException({
        code: 'ORDER_STATUS_INVALID',
        message: 'Mark-delivered requires the order to be in transit.',
      });
    }
    const updated = await this.prisma.order.update({
      where: { id: input.orderId },
      data: {
        status: OrderStatus.DELIVERED,
        deliveredAt: new Date(),
        deliveredBy: input.deliveredBy?.trim() ?? null,
      },
    });
    await this.audit.record({
      actorId: input.adminId,
      actorEmail: input.adminEmail,
      action: 'order.delivered',
      targetType: 'Order',
      targetId: input.orderId,
      before: { status: order.status },
      after: { status: OrderStatus.DELIVERED, deliveredBy: input.deliveredBy ?? null },
    });
    return { orderId: updated.id, status: updated.status };
  }

  /**
   * Admin cancel — emergency exit, e.g. duplicate auction or fraud.
   * Allowed only before fulfilment starts (PENDING_ADDRESS or
   * AWAITING_FULFILLMENT). After ship there's no clean cancel —
   * dispute is the path.
   */
  async cancel(input: {
    adminId: string;
    adminEmail: string;
    orderId: string;
    reason: string;
  }): Promise<{ orderId: string; status: OrderStatus }> {
    if (input.reason.trim().length < 4) {
      throw new BadRequestException({ code: 'CANCEL_REASON_REQUIRED' });
    }
    const order = await this.requireOrder(input.orderId);
    if (
      order.status !== OrderStatus.PENDING_ADDRESS &&
      order.status !== OrderStatus.AWAITING_FULFILLMENT
    ) {
      throw new ConflictException({
        code: 'ORDER_CANCEL_NOT_ALLOWED',
        message: 'Cancel is only allowed before the order ships.',
      });
    }
    const updated = await this.prisma.order.update({
      where: { id: input.orderId },
      data: { status: OrderStatus.CANCELLED, disputeReason: input.reason.trim() },
    });
    await this.audit.record({
      actorId: input.adminId,
      actorEmail: input.adminEmail,
      action: 'order.cancelled',
      targetType: 'Order',
      targetId: input.orderId,
      before: { status: order.status },
      after: { status: OrderStatus.CANCELLED, reason: input.reason.trim() },
    });
    return { orderId: updated.id, status: updated.status };
  }

  // ─── helpers ──────────────────────────────────────────────────

  private async requireOrder(id: string) {
    const row = await this.prisma.order.findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ code: 'ORDER_NOT_FOUND' });
    return row;
  }

  private async requireOrderOwnedBy(userId: string, orderId: string) {
    const row = await this.requireOrder(orderId);
    if (row.winnerId !== userId) {
      throw new ForbiddenException({ code: 'NOT_YOUR_ORDER' });
    }
    return row;
  }

  private isUniqueViolation(err: unknown): boolean {
    return Boolean(
      err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code?: string }).code === 'P2002',
    );
  }
}

export interface OrderListItem {
  id: string;
  status: OrderStatus;
  auctionTitle: string;
  retailPrice: number;
  carrierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  disputedAt: Date | null;
  createdAt: Date;
}

export interface OrderDetailView {
  id: string;
  status: OrderStatus;
  auctionId: string;
  shippingAddressId: string | null;
  shippingAddressSnapshot: Prisma.JsonValue;
  carrierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  disputedAt: Date | null;
  disputeReason: string | null;
  fulfillmentNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminOrderRow {
  id: string;
  status: OrderStatus;
  winnerId: string;
  auctionId: string;
  auctionTitle: string;
  retailPrice: number;
  hasAddress: boolean;
  carrierName: string | null;
  trackingNumber: string | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  disputedAt: Date | null;
  updatedAt: Date;
}
