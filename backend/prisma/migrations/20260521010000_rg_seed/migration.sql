-- Seed: notification templates for the responsible-gambling lifecycle.
--
-- All three templates use the `rg_` prefix so the NotificationService
-- regulatory carve-out applies — they bypass marketing opt-outs by
-- design. Compliance-required communication.
--
-- ON CONFLICT DO NOTHING — safe to re-run.

INSERT INTO "NotificationTemplate" (id, code, channel, locale, subject, body, variables, active, version, "updatedAt", "createdAt")
VALUES
  -- Limit changed (any direction).
  ('tpl-rg-limit-changed-v1-email-en',
   'rg_limit_changed_v1',
   'EMAIL',
   'en',
   'Your responsible-gambling limits changed',
   $$Hi,

The following responsible-gambling limit setting(s) just changed on your account: {{changes}}.

You can view the current limits any time at /me/rg.

If you didn't make this change, contact support immediately.

— Kalki Auctions$$,
   '{"username":"string","changes":"string"}',
   true, 1, NOW(), NOW()),
  ('tpl-rg-limit-changed-v1-inapp-en',
   'rg_limit_changed_v1',
   'INAPP',
   'en',
   'Limits updated',
   'Your responsible-gambling limits changed: {{changes}}.',
   '{"username":"string","changes":"string"}',
   true, 1, NOW(), NOW()),

  -- Cool-down started.
  ('tpl-rg-cooldown-started-v1-email-en',
   'rg_cooldown_started_v1',
   'EMAIL',
   'en',
   'Your Kalki cool-down period has started',
   $$Hi,

A {{durationLabel}} cool-down is now in effect on your account. You will not be able to sign in or place bets until {{endsAt}}.

Cool-downs cannot be cancelled early — that's by design. The break starts now.

— Kalki Auctions$$,
   '{"durationLabel":"string","endsAt":"string"}',
   true, 1, NOW(), NOW()),
  ('tpl-rg-cooldown-started-v1-inapp-en',
   'rg_cooldown_started_v1',
   'INAPP',
   'en',
   'Cool-down active',
   '{{durationLabel}} cool-down in effect until {{endsAt}}. You will not be able to sign in until then.',
   '{"durationLabel":"string","endsAt":"string"}',
   true, 1, NOW(), NOW()),

  -- Self-exclusion started.
  ('tpl-rg-self-excluded-v1-email-en',
   'rg_self_excluded_v1',
   'EMAIL',
   'en',
   'Your Kalki self-exclusion has started',
   $$Hi,

A {{durationLabel}} self-exclusion is now in effect on your account.

If you need help, the National Helpline for Problem Gambling is 1800-599-0019 (toll-free, 24×7, India).

Self-exclusions cannot be cancelled early. For permanent exclusion, contact support if you ever want to discuss reopening after the cool-off.

— Kalki Auctions$$,
   '{"durationLabel":"string","endsAt":"string"}',
   true, 1, NOW(), NOW()),
  ('tpl-rg-self-excluded-v1-inapp-en',
   'rg_self_excluded_v1',
   'INAPP',
   'en',
   'Self-exclusion active',
   'A {{durationLabel}} self-exclusion is now in effect. Help is available at 1800-599-0019 (24×7).',
   '{"durationLabel":"string","endsAt":"string"}',
   true, 1, NOW(), NOW())
ON CONFLICT (code, channel, locale) DO NOTHING;
