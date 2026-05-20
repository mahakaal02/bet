-- Seed: the `auction_outbid_v1` notification template family +
-- the master feature flags that gate the new notification
-- pipeline.
--
-- Idempotent (`ON CONFLICT DO NOTHING`) so re-running this
-- migration on environments where a partial seed already landed
-- (via admin UI bootstrap, for example) is safe.

-- ─── Feature flags ──────────────────────────────────────────────────

INSERT INTO "FeatureFlag" (id, description, mode, enabled, "rolloutPercent", "updatedAt", "createdAt")
VALUES
  ('notifications.enabled',
   'Master switch for the new notification worker. OFF = notifications enqueue but do not dispatch (Notification rows pile up in PENDING; a flag flip drains the backlog).',
   'BOOLEAN', false, 0, NOW(), NOW()),
  ('watchlist.enabled',
   'Watchlist feature toggle. ON exposes the Watch/Unwatch endpoints + the My Watchlist page.',
   'BOOLEAN', false, 0, NOW(), NOW()),
  ('watchlist.outbid_notifications',
   'Outbid notification listener. ON makes the bid-placement service enqueue auction_outbid_v1 to displaced watchers. Layered on top of notifications.enabled and watchlist.enabled.',
   'BOOLEAN', false, 0, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- ─── Templates ──────────────────────────────────────────────────────
-- `auction_outbid_v1` ships per-channel rows: PUSH, EMAIL, INAPP.
-- All three share the same variable schema so the body author can
-- swap channels with no payload changes.

INSERT INTO "NotificationTemplate" (id, code, channel, locale, subject, body, variables, active, version, "updatedAt", "createdAt")
VALUES
  -- PUSH
  ('tpl-auction-outbid-v1-push-en',
   'auction_outbid_v1',
   'PUSH',
   'en',
   'You were outbid on {{auctionTitle}}',
   'A lower unique bid landed at {{newBidAmount}}. Tap to place a new bid.',
   '{"auctionTitle":"string","newBidAmount":"string","retailPrice":"string"}',
   true, 1, NOW(), NOW()),
  -- EMAIL — body is plain text; HTML rendering layered on top by the
  -- email adapter (PR-NOTIFY-2 wires the HTML wrapper template).
  ('tpl-auction-outbid-v1-email-en',
   'auction_outbid_v1',
   'EMAIL',
   'en',
   'You were outbid on {{auctionTitle}} — Kalki Auctions',
   $$Hi,

A lower unique bid just landed on the auction "{{auctionTitle}}" at {{newBidAmount}} coins. You were holding the lowest unique amount; that position is no longer yours.

Place a new bid to take it back: https://kalki-auctions.cloud.podstack.ai/

— Kalki Auctions$$,
   '{"auctionTitle":"string","newBidAmount":"string","retailPrice":"string"}',
   true, 1, NOW(), NOW()),
  -- IN-APP — short, action-oriented. Body is text (renderer HTML-escapes).
  ('tpl-auction-outbid-v1-inapp-en',
   'auction_outbid_v1',
   'INAPP',
   'en',
   'Outbid on {{auctionTitle}}',
   'A lower unique bid landed at {{newBidAmount}} coins. Tap to place a new bid.',
   '{"auctionTitle":"string","newBidAmount":"string","retailPrice":"string"}',
   true, 1, NOW(), NOW())
ON CONFLICT (code, channel, locale) DO NOTHING;
