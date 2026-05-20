import { NotificationService } from './notification.service';
import { NotificationChannel } from '@prisma/client';

/**
 * Notification service unit tests. The expensive bit (template
 * render + per-channel dispatch) is covered by the renderer + adapter
 * specs separately — these tests focus on:
 *
 *   1. Channel filtering against NotificationPreference
 *   2. Idempotency: same anchor → no double-write
 *   3. The regulatory carve-out for responsible-gambling templates
 */
describe('NotificationService', () => {
  function makeService(prismaMock: any): NotificationService {
    return new NotificationService(prismaMock);
  }

  // ─── Channel filtering ────────────────────────────────────────────

  describe('channel filtering by preferences', () => {
    it('drops PUSH for a user who has opted out of marketingPush', async () => {
      const upsertMock = jest.fn(async ({ create }: any) => ({
        ...create,
        id: 'notif-1',
        createdAt: new Date(),
        readAt: null,
      }));
      const prefs = {
        outbid: true,
        auctionEnding: true,
        orderUpdates: true,
        dailyStreak: true,
        marketingPush: false,                 // <-- under test
        marketingEmail: true,
        responsibleGambling: true,
      };
      const prismaMock = {
        notificationPreference: { findUnique: jest.fn(async () => prefs) },
        notification: { upsert: upsertMock },
      };
      const svc = makeService(prismaMock);

      await svc.enqueue({
        templateCode: 'marketing_summer_sale_v1',
        userId: 'user-1',
        payload: { headline: 'hi' },
        idempotencyAnchor: 'campaign:42',
        channels: [
          NotificationChannel.PUSH,
          NotificationChannel.EMAIL,
          NotificationChannel.INAPP,
        ],
      });

      // Should have upserted only EMAIL (and NOT PUSH or INAPP).
      const channelsSeen = upsertMock.mock.calls.map(
        (c) => c[0].create.channel,
      );
      expect(channelsSeen).toEqual([NotificationChannel.EMAIL]);
    });

    it('always sends responsible-gambling templates, even if marketing is off', async () => {
      const upsertMock = jest.fn(async ({ create }: any) => ({
        ...create,
        id: 'notif-1',
        createdAt: new Date(),
      }));
      const prefs = {
        outbid: false,
        auctionEnding: false,
        orderUpdates: false,
        dailyStreak: false,
        marketingPush: false,
        marketingEmail: false,
        responsibleGambling: true,
      };
      const prismaMock = {
        notificationPreference: { findUnique: jest.fn(async () => prefs) },
        notification: { upsert: upsertMock },
      };
      const svc = makeService(prismaMock);

      await svc.enqueue({
        templateCode: 'rg_daily_loss_limit_reached',
        userId: 'user-1',
        payload: { limitCoins: 50000 },
        idempotencyAnchor: 'rg:loss:user-1:2026-05-20',
      });

      expect(upsertMock).toHaveBeenCalledTimes(3); // PUSH + EMAIL + INAPP
    });

    it('uses default preferences when no preference row exists', async () => {
      const upsertMock = jest.fn(async ({ create }: any) => ({
        ...create,
        id: 'notif-1',
        createdAt: new Date(),
      }));
      const prismaMock = {
        notificationPreference: { findUnique: jest.fn(async () => null) },
        notification: { upsert: upsertMock },
      };
      const svc = makeService(prismaMock);

      // Transactional (outbid) — defaults all-on.
      await svc.enqueue({
        templateCode: 'auction_outbid_v1',
        userId: 'user-2',
        payload: {},
        idempotencyAnchor: 'anchor-1',
      });

      expect(upsertMock).toHaveBeenCalledTimes(3);
    });

    it('drops all channels when none are requested', async () => {
      const upsertMock = jest.fn();
      const prismaMock = {
        notificationPreference: { findUnique: jest.fn(async () => null) },
        notification: { upsert: upsertMock },
      };
      const svc = makeService(prismaMock);

      await svc.enqueue({
        templateCode: 'auction_outbid_v1',
        userId: 'user-3',
        payload: {},
        idempotencyAnchor: 'anchor-3',
        channels: [],                          // empty list → drop everything
      });

      expect(upsertMock).not.toHaveBeenCalled();
    });
  });

  // ─── Idempotency ──────────────────────────────────────────────────

  describe('idempotency', () => {
    it('computes a stable key for (user, template, channel, anchor)', async () => {
      const seen: string[] = [];
      const upsertMock = jest.fn(async (args: any) => {
        seen.push(args.where.idempotencyKey);
        return { ...args.create, id: 'notif-1', createdAt: new Date() };
      });
      const prismaMock = {
        notificationPreference: { findUnique: jest.fn(async () => null) },
        notification: { upsert: upsertMock },
      };
      const svc = makeService(prismaMock);

      await svc.enqueue({
        templateCode: 'auction_outbid_v1',
        userId: 'user-1',
        payload: {},
        idempotencyAnchor: 'auction:abc:outbid:user-1:bid-7',
        channels: [NotificationChannel.PUSH],
      });
      await svc.enqueue({
        templateCode: 'auction_outbid_v1',
        userId: 'user-1',
        payload: {},
        idempotencyAnchor: 'auction:abc:outbid:user-1:bid-7',
        channels: [NotificationChannel.PUSH],
      });

      // Same anchor → identical idempotency key. The DB-level upsert
      // turns the second call into a no-op (we model that with
      // identical mock returns); we just need to confirm the key
      // computation is stable.
      expect(seen).toHaveLength(2);
      expect(seen[0]).toBe(seen[1]);
    });

    it('produces different keys for different channels of the same event', async () => {
      const seen: string[] = [];
      const upsertMock = jest.fn(async (args: any) => {
        seen.push(args.where.idempotencyKey);
        return { ...args.create, id: 'notif-1', createdAt: new Date() };
      });
      const prismaMock = {
        notificationPreference: { findUnique: jest.fn(async () => null) },
        notification: { upsert: upsertMock },
      };
      const svc = makeService(prismaMock);

      await svc.enqueue({
        templateCode: 'auction_outbid_v1',
        userId: 'user-1',
        payload: {},
        idempotencyAnchor: 'same-anchor',
      });

      // 3 channels (PUSH + EMAIL + INAPP), 3 distinct keys.
      const distinct = new Set(seen);
      expect(distinct.size).toBe(3);
    });

    it('produces different keys for different users with the same anchor', async () => {
      const seen: string[] = [];
      const upsertMock = jest.fn(async (args: any) => {
        seen.push(args.where.idempotencyKey);
        return { ...args.create, id: 'notif-1', createdAt: new Date() };
      });
      const prismaMock = {
        notificationPreference: { findUnique: jest.fn(async () => null) },
        notification: { upsert: upsertMock },
      };
      const svc = makeService(prismaMock);

      await svc.enqueue({
        templateCode: 'auction_outbid_v1',
        userId: 'user-1',
        payload: {},
        idempotencyAnchor: 'anchor-X',
        channels: [NotificationChannel.PUSH],
      });
      await svc.enqueue({
        templateCode: 'auction_outbid_v1',
        userId: 'user-2',
        payload: {},
        idempotencyAnchor: 'anchor-X',
        channels: [NotificationChannel.PUSH],
      });

      expect(seen[0]).not.toBe(seen[1]);
    });
  });
});
