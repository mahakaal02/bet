-- PR-RG-2 schema additions:
--
--   1. `pendingLimits` + `pendingActivatesAt` — 24h cool-off bucket for
--      limit RAISES. Lower is still instant; raise stages here and
--      applies after the activate moment unless the user cancels.
--   2. `sessionStartedAt` / `lastSessionPingAt` — session-reminder
--      tracking. The heartbeat endpoint walks these every minute and
--      fires a notification once the user has been active for the
--      `sessionReminderMinutes` threshold.
--   3. `lastReminderAt` — debounce so the toast doesn't re-fire on every
--      subsequent heartbeat once the threshold is crossed.

ALTER TABLE "ResponsibleGamblingProfile"
  ADD COLUMN "pendingLimits" jsonb,
  ADD COLUMN "pendingActivatesAt" timestamp(3),
  ADD COLUMN "sessionStartedAt" timestamp(3),
  ADD COLUMN "lastSessionPingAt" timestamp(3),
  ADD COLUMN "lastReminderAt" timestamp(3);

-- Notification templates for the new session-reminder + pending-raise
-- events. `rg_` prefix triggers the marketing-opt-out carve-out so
-- they always reach the user.

INSERT INTO "NotificationTemplate" (id, code, channel, locale, subject, body, variables, active, version, "updatedAt", "createdAt")
VALUES
  ('tpl-rg-session-reminder-v1-inapp-en',
   'rg_session_reminder_v1',
   'INAPP',
   'en',
   'Quick check-in',
   $$You've been playing for {{minutes}} minutes. Take a break if you need one — wagers can wait.$$,
   '{"minutes":"string"}',
   true, 1, NOW(), NOW()),
  ('tpl-rg-pending-raise-v1-email-en',
   'rg_pending_raise_v1',
   'EMAIL',
   'en',
   'Your responsible-gambling limit change is scheduled',
   $$Hi,

You requested a change to a responsible-gambling limit that loosens your controls. As a safety measure, that change takes effect in 24 hours.

If you change your mind, cancel the pending change any time before then at /me/rg.

If you didn't request this, contact support immediately.

— Kalki Auctions$$,
   '{"username":"string","activatesAt":"string"}',
   true, 1, NOW(), NOW()),
  ('tpl-rg-pending-raise-v1-inapp-en',
   'rg_pending_raise_v1',
   'INAPP',
   'en',
   'Limit change scheduled',
   $$Your loosened limits take effect at {{activatesAt}}. Cancel any time before then.$$,
   '{"username":"string","activatesAt":"string"}',
   true, 1, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
