import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { OrdersService } from './orders.service';

/**
 * Tests cover the state machine end-to-end:
 *
 *   1. createForWin idempotent on replay (P2002 → return existing).
 *   2. setShippingAddress: PENDING_ADDRESS → AWAITING_FULFILLMENT,
 *      snapshots the address, refuses cross-user spoofing, refuses
 *      soft-deleted addresses.
 *   3. ship: AWAITING_FULFILLMENT → IN_TRANSIT, requires carrier +
 *      tracking, audit row.
 *   4. markDelivered: IN_TRANSIT → DELIVERED only, audit row.
 *   5. dispute: 10-char reason gate, allowed only from IN_TRANSIT /
 *      DELIVERED, audit row.
 *   6. cancel: allowed only before ship, 4-char reason gate.
 *   7. listMine + listForAdmin shape spot-check.
 */

interface OrderRow {
  id: string;
  auctionId: string;
  winnerId: string;
  status: OrderStatus;
  shippingAddressId: string | null;
  shippingAddressSnapshot: unknown;
  carrierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  fulfillmentNotes: string | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  deliveredBy: string | null;
  disputedAt: Date | null;
  disputeReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface AddrRow {
  id: string;
  userId: string;
  fullName: string;
  phoneE164: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  countryIso2: string;
  deletedAt: Date | null;
}

function makeMocks(opts: {
  orders?: OrderRow[];
  addresses?: AddrRow[];
  auctions?: Array<{ id: string; title: string; retailPrice: number }>;
} = {}) {
  const orders = (opts.orders ?? []).map((o) => ({ ...o }));
  const addresses = (opts.addresses ?? []).map((a) => ({ ...a }));
  const auctions = new Map<string, { title: string; retailPrice: number }>(
    (opts.auctions ?? []).map((a) => [a.id, { title: a.title, retailPrice: a.retailPrice }]),
  );

  const prisma: any = {
    order: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id) return orders.find((o) => o.id === where.id) ?? null;
        if (where.auctionId) return orders.find((o) => o.auctionId === where.auctionId) ?? null;
        return null;
      }),
      findMany: jest.fn(async ({ where, orderBy, take, cursor, skip, include }: any) => {
        void orderBy;
        let pool = orders.slice();
        if (where?.winnerId) pool = pool.filter((o) => o.winnerId === where.winnerId);
        if (where?.status) pool = pool.filter((o) => o.status === where.status);
        pool.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        if (cursor) {
          const idx = pool.findIndex((o) => o.id === cursor.id);
          if (idx >= 0) pool = pool.slice(idx + (skip ?? 0));
        }
        const out = pool.slice(0, take ?? pool.length);
        if (include?.auction) {
          return out.map((o) => ({
            ...o,
            auction: auctions.get(o.auctionId) ?? { title: 'unknown', retailPrice: 0 },
          }));
        }
        return out;
      }),
      create: jest.fn(async ({ data }: any) => {
        if (orders.some((o) => o.auctionId === data.auctionId)) {
          const err: any = new Error('unique');
          err.code = 'P2002';
          throw err;
        }
        const row: OrderRow = {
          id: `o-${orders.length + 1}`,
          auctionId: data.auctionId,
          winnerId: data.winnerId,
          status: data.status,
          shippingAddressId: null,
          shippingAddressSnapshot: null,
          carrierName: null,
          trackingNumber: null,
          trackingUrl: null,
          fulfillmentNotes: null,
          shippedAt: null,
          deliveredAt: null,
          deliveredBy: null,
          disputedAt: null,
          disputeReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        orders.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const o = orders.find((r) => r.id === where.id);
        if (!o) throw new Error('no order');
        Object.assign(o, data, { updatedAt: new Date() });
        return o;
      }),
    },
    shippingAddress: {
      findFirst: jest.fn(async ({ where }: any) =>
        addresses.find(
          (a) =>
            a.id === where.id &&
            a.userId === where.userId &&
            (where.deletedAt === null ? a.deletedAt === null : true),
        ) ?? null,
      ),
    },
  };

  const audit = { record: jest.fn(async () => undefined) };
  const svc = new OrdersService(prisma, audit as any);
  return { svc, prisma, audit, _orders: () => orders };
}

const ADMIN = { id: 'admin-1', email: 'admin@kalki.test' };

const SAMPLE_ADDRESS: AddrRow = {
  id: 'addr-1',
  userId: 'u-1',
  fullName: 'Alice Doe',
  phoneE164: '+919999999999',
  line1: '1 Sample Street',
  line2: null,
  city: 'Bangalore',
  state: 'KA',
  postalCode: '560001',
  countryIso2: 'IN',
  deletedAt: null,
};

const SAMPLE_ORDER: OrderRow = {
  id: 'o-1',
  auctionId: 'a-1',
  winnerId: 'u-1',
  status: OrderStatus.PENDING_ADDRESS,
  shippingAddressId: null,
  shippingAddressSnapshot: null,
  carrierName: null,
  trackingNumber: null,
  trackingUrl: null,
  fulfillmentNotes: null,
  shippedAt: null,
  deliveredAt: null,
  deliveredBy: null,
  disputedAt: null,
  disputeReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('OrdersService.createForWin', () => {
  it('creates a new PENDING_ADDRESS order', async () => {
    const { svc, _orders } = makeMocks();
    const row = await svc.createForWin({ auctionId: 'a-1', winnerId: 'u-1' });
    expect(row.status).toBe(OrderStatus.PENDING_ADDRESS);
    expect(_orders()).toHaveLength(1);
  });

  it('idempotent on replay (returns existing row)', async () => {
    const { svc, _orders } = makeMocks({ orders: [SAMPLE_ORDER] });
    const row = await svc.createForWin({ auctionId: 'a-1', winnerId: 'u-1' });
    expect(row.id).toBe('o-1');
    expect(_orders()).toHaveLength(1);
  });
});

describe('OrdersService.setShippingAddress', () => {
  it('transitions PENDING_ADDRESS → AWAITING_FULFILLMENT', async () => {
    const { svc, _orders } = makeMocks({
      orders: [SAMPLE_ORDER],
      addresses: [SAMPLE_ADDRESS],
    });
    const res = await svc.setShippingAddress({
      userId: 'u-1',
      orderId: 'o-1',
      addressId: 'addr-1',
    });
    expect(res.status).toBe(OrderStatus.AWAITING_FULFILLMENT);
    expect(_orders()[0].shippingAddressId).toBe('addr-1');
    const snap = _orders()[0].shippingAddressSnapshot as Record<string, unknown>;
    expect(snap).toMatchObject({ city: 'Bangalore', postalCode: '560001' });
  });

  it("rejects another user's address", async () => {
    const { svc } = makeMocks({
      orders: [SAMPLE_ORDER],
      addresses: [{ ...SAMPLE_ADDRESS, userId: 'u-other' }],
    });
    await expect(
      svc.setShippingAddress({ userId: 'u-1', orderId: 'o-1', addressId: 'addr-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects soft-deleted addresses", async () => {
    const { svc } = makeMocks({
      orders: [SAMPLE_ORDER],
      addresses: [{ ...SAMPLE_ADDRESS, deletedAt: new Date() }],
    });
    await expect(
      svc.setShippingAddress({ userId: 'u-1', orderId: 'o-1', addressId: 'addr-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses if order is past PENDING_ADDRESS', async () => {
    const { svc } = makeMocks({
      orders: [{ ...SAMPLE_ORDER, status: OrderStatus.IN_TRANSIT }],
      addresses: [SAMPLE_ADDRESS],
    });
    await expect(
      svc.setShippingAddress({ userId: 'u-1', orderId: 'o-1', addressId: 'addr-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to act on someone else\'s order', async () => {
    const { svc } = makeMocks({
      orders: [SAMPLE_ORDER],
      addresses: [SAMPLE_ADDRESS],
    });
    await expect(
      svc.setShippingAddress({ userId: 'spoof', orderId: 'o-1', addressId: 'addr-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('OrdersService.ship', () => {
  it('transitions AWAITING_FULFILLMENT → IN_TRANSIT + audits', async () => {
    const { svc, audit, _orders } = makeMocks({
      orders: [{ ...SAMPLE_ORDER, status: OrderStatus.AWAITING_FULFILLMENT }],
    });
    await svc.ship({
      adminId: ADMIN.id,
      adminEmail: ADMIN.email,
      orderId: 'o-1',
      carrierName: 'DTDC',
      trackingNumber: 'DTDC123',
      trackingUrl: 'https://t.dtdc.in/DTDC123',
    });
    expect(_orders()[0].status).toBe(OrderStatus.IN_TRANSIT);
    expect(_orders()[0].carrierName).toBe('DTDC');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'order.shipped' }),
    );
  });

  it('400s on missing carrier / tracking', async () => {
    const { svc } = makeMocks({
      orders: [{ ...SAMPLE_ORDER, status: OrderStatus.AWAITING_FULFILLMENT }],
    });
    await expect(
      svc.ship({
        adminId: ADMIN.id,
        adminEmail: ADMIN.email,
        orderId: 'o-1',
        carrierName: '',
        trackingNumber: 'xx',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to ship from PENDING_ADDRESS', async () => {
    const { svc } = makeMocks({ orders: [SAMPLE_ORDER] });
    await expect(
      svc.ship({
        adminId: ADMIN.id,
        adminEmail: ADMIN.email,
        orderId: 'o-1',
        carrierName: 'DTDC',
        trackingNumber: 'X',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('OrdersService.markDelivered', () => {
  it('transitions IN_TRANSIT → DELIVERED', async () => {
    const { svc, _orders, audit } = makeMocks({
      orders: [{ ...SAMPLE_ORDER, status: OrderStatus.IN_TRANSIT }],
    });
    await svc.markDelivered({
      adminId: ADMIN.id,
      adminEmail: ADMIN.email,
      orderId: 'o-1',
      deliveredBy: 'courier_pic.jpg',
    });
    expect(_orders()[0].status).toBe(OrderStatus.DELIVERED);
    expect(_orders()[0].deliveredBy).toBe('courier_pic.jpg');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'order.delivered' }),
    );
  });

  it('refuses to skip-ahead from AWAITING_FULFILLMENT', async () => {
    const { svc } = makeMocks({
      orders: [{ ...SAMPLE_ORDER, status: OrderStatus.AWAITING_FULFILLMENT }],
    });
    await expect(
      svc.markDelivered({ adminId: ADMIN.id, adminEmail: ADMIN.email, orderId: 'o-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('OrdersService.dispute', () => {
  it('requires ≥ 10-char reason', async () => {
    const { svc } = makeMocks({
      orders: [{ ...SAMPLE_ORDER, status: OrderStatus.IN_TRANSIT }],
    });
    await expect(
      svc.dispute({ userId: 'u-1', orderId: 'o-1', reason: 'too short' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses from PENDING_ADDRESS or AWAITING_FULFILLMENT', async () => {
    const { svc } = makeMocks({ orders: [SAMPLE_ORDER] });
    await expect(
      svc.dispute({ userId: 'u-1', orderId: 'o-1', reason: 'package never arrived' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('IN_TRANSIT or DELIVERED → DISPUTED with audit', async () => {
    const { svc, _orders, audit } = makeMocks({
      orders: [{ ...SAMPLE_ORDER, status: OrderStatus.DELIVERED }],
    });
    await svc.dispute({
      userId: 'u-1',
      orderId: 'o-1',
      reason: 'item arrived damaged in transit',
    });
    expect(_orders()[0].status).toBe(OrderStatus.DISPUTED);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'order.dispute_opened' }),
    );
  });
});

describe('OrdersService.cancel', () => {
  it('allows cancel from PENDING_ADDRESS', async () => {
    const { svc, _orders } = makeMocks({ orders: [SAMPLE_ORDER] });
    await svc.cancel({
      adminId: ADMIN.id,
      adminEmail: ADMIN.email,
      orderId: 'o-1',
      reason: 'duplicate',
    });
    expect(_orders()[0].status).toBe(OrderStatus.CANCELLED);
  });

  it('refuses after ship', async () => {
    const { svc } = makeMocks({
      orders: [{ ...SAMPLE_ORDER, status: OrderStatus.IN_TRANSIT }],
    });
    await expect(
      svc.cancel({
        adminId: ADMIN.id,
        adminEmail: ADMIN.email,
        orderId: 'o-1',
        reason: 'changed mind',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('OrdersService.listMine / listForAdmin', () => {
  it('listMine returns the user\'s orders newest-first', async () => {
    const { svc } = makeMocks({
      orders: [
        { ...SAMPLE_ORDER, id: 'o-old', updatedAt: new Date(Date.now() - 100_000) },
        { ...SAMPLE_ORDER, id: 'o-new', updatedAt: new Date() },
      ],
      auctions: [{ id: 'a-1', title: 'Test SKU', retailPrice: 12999 }],
    });
    const items = await svc.listMine('u-1');
    expect(items.length).toBe(2);
    expect(items[0].auctionTitle).toBe('Test SKU');
  });

  it('listForAdmin filters by status', async () => {
    const { svc } = makeMocks({
      orders: [
        { ...SAMPLE_ORDER, id: 'o-a', status: OrderStatus.AWAITING_FULFILLMENT },
        { ...SAMPLE_ORDER, id: 'o-b', status: OrderStatus.IN_TRANSIT },
      ],
      auctions: [{ id: 'a-1', title: 'X', retailPrice: 100 }],
    });
    const res = await svc.listForAdmin({ status: OrderStatus.IN_TRANSIT });
    expect(res.items.map((i) => i.id)).toEqual(['o-b']);
  });
});

describe('OrdersService.getMine / requireOrderOwnedBy', () => {
  it('404s on missing', async () => {
    const { svc } = makeMocks({ orders: [] });
    await expect(svc.getMine('u-1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it("403s on another user's order", async () => {
    const { svc } = makeMocks({ orders: [SAMPLE_ORDER] });
    await expect(svc.getMine('spoof', 'o-1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
