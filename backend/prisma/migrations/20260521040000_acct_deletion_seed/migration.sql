-- Seed: notification templates for account-deletion lifecycle.
--
-- ON CONFLICT DO NOTHING — safe to re-run.

INSERT INTO "NotificationTemplate" (id, code, channel, locale, subject, body, variables, active, version, "updatedAt", "createdAt")
VALUES
  -- account_deletion_requested_v1 — EMAIL + INAPP
  ('tpl-acct-del-req-v1-email-en',
   'account_deletion_requested_v1',
   'EMAIL',
   'en',
   'Your Kalki account deletion is scheduled',
   $$Hi,

You've requested to close your Kalki account. The deletion takes
effect on {{effectiveAt}} ({{daysRemaining}} days from now).

You can cancel any time before then by signing in and clicking
"Cancel deletion" on the profile page. After the cool-off ends,
your personal information will be removed and the account closure
becomes permanent.

If this wasn't you, sign in and cancel the request immediately,
then change your password.

— Kalki Auctions$$,
   '{"effectiveAt":"string","daysRemaining":"string"}',
   true, 1, NOW(), NOW()),
  ('tpl-acct-del-req-v1-inapp-en',
   'account_deletion_requested_v1',
   'INAPP',
   'en',
   'Account deletion scheduled',
   'Your account will be closed on {{effectiveAt}}. Cancel any time before then.',
   '{"effectiveAt":"string","daysRemaining":"string"}',
   true, 1, NOW(), NOW()),

  -- account_deletion_cancelled_v1
  ('tpl-acct-del-cancel-v1-email-en',
   'account_deletion_cancelled_v1',
   'EMAIL',
   'en',
   'Your Kalki account deletion is cancelled',
   $$Hi,

The pending deletion of your Kalki account has been cancelled.
Your account is restored to normal.

If you didn't cancel this, change your password immediately.

— Kalki Auctions$$,
   '{}',
   true, 1, NOW(), NOW()),
  ('tpl-acct-del-cancel-v1-inapp-en',
   'account_deletion_cancelled_v1',
   'INAPP',
   'en',
   'Deletion cancelled',
   'Pending account deletion was cancelled. Your account is back to normal.',
   '{}',
   true, 1, NOW(), NOW())
ON CONFLICT (code, channel, locale) DO NOTHING;
