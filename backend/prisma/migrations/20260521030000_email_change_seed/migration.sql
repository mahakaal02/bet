-- Seed: email_change_applied_v1 notification template.
--
-- Fired AFTER both confirmation tokens land. Routes to the user's
-- newly-current email via the notification pipeline (the old +
-- new confirmation tokens themselves are sent directly via
-- EmailAdapter.sendDirect because the new address isn't yet on
-- the user row — see EmailChangeService).
--
-- ON CONFLICT DO NOTHING — safe re-run.

INSERT INTO "NotificationTemplate" (id, code, channel, locale, subject, body, variables, active, version, "updatedAt", "createdAt")
VALUES
  ('tpl-email-change-applied-v1-email-en',
   'email_change_applied_v1',
   'EMAIL',
   'en',
   'Your Kalki email was changed',
   $$Hi,

Your Kalki account email has been changed from {{oldEmail}} to {{newEmail}}. Future sign-in messages and notifications will go to this address.

If this wasn't you, contact support immediately — your account may be compromised.

— Kalki Auctions$$,
   '{"oldEmail":"string","newEmail":"string"}',
   true, 1, NOW(), NOW()),
  ('tpl-email-change-applied-v1-inapp-en',
   'email_change_applied_v1',
   'INAPP',
   'en',
   'Email changed',
   'Your Kalki account email is now {{newEmail}}.',
   '{"oldEmail":"string","newEmail":"string"}',
   true, 1, NOW(), NOW())
ON CONFLICT (code, channel, locale) DO NOTHING;
