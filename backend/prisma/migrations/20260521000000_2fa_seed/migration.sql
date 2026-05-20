-- Seed: notification templates for the two-factor lifecycle.
--
--   2fa_enabled_v1   — fires on successful verification (the user
--                      just turned 2FA on). Triple-channel because
--                      this is a security event the user must notice
--                      across every device.
--
--   2fa_disabled_v1  — fires when 2FA is turned off (legit or
--                      attacker-driven). Same triple-channel for the
--                      same reason — the legitimate user reading
--                      "your 2FA was disabled" while their hands
--                      are nowhere near it is the canonical
--                      compromise signal.
--
-- ON CONFLICT DO NOTHING — re-running the migration on top of an
-- already-seeded row is safe.

INSERT INTO "NotificationTemplate" (id, code, channel, locale, subject, body, variables, active, version, "updatedAt", "createdAt")
VALUES
  -- 2fa_enabled_v1
  ('tpl-2fa-enabled-v1-email-en',
   '2fa_enabled_v1',
   'EMAIL',
   'en',
   '2FA was just enabled on your Kalki account',
   $$Hi {{username}},

Two-factor authentication has been enabled on your Kalki account. From now on you'll need a code from your authenticator app to sign in.

If this wasn't you, contact support immediately and reset your password — your account may be compromised.

— Kalki Auctions$$,
   '{"username":"string"}',
   true, 1, NOW(), NOW()),
  ('tpl-2fa-enabled-v1-push-en',
   '2fa_enabled_v1',
   'PUSH',
   'en',
   '2FA enabled',
   'Two-factor authentication is now on. If this wasn''t you, open the app and contact support right away.',
   '{"username":"string"}',
   true, 1, NOW(), NOW()),
  ('tpl-2fa-enabled-v1-inapp-en',
   '2fa_enabled_v1',
   'INAPP',
   'en',
   '2FA enabled',
   'Two-factor authentication is now on for your account. If this wasn''t you, contact support.',
   '{"username":"string"}',
   true, 1, NOW(), NOW()),

  -- 2fa_disabled_v1
  ('tpl-2fa-disabled-v1-email-en',
   '2fa_disabled_v1',
   'EMAIL',
   'en',
   '2FA was just disabled on your Kalki account',
   $$Hi {{username}},

Two-factor authentication has been disabled on your Kalki account. Sign-in now requires only your password.

If this wasn't you, contact support immediately and reset your password — your account may be compromised.

— Kalki Auctions$$,
   '{"username":"string"}',
   true, 1, NOW(), NOW()),
  ('tpl-2fa-disabled-v1-push-en',
   '2fa_disabled_v1',
   'PUSH',
   'en',
   '2FA disabled',
   'Two-factor authentication has been turned off. If this wasn''t you, contact support right away.',
   '{"username":"string"}',
   true, 1, NOW(), NOW()),
  ('tpl-2fa-disabled-v1-inapp-en',
   '2fa_disabled_v1',
   'INAPP',
   'en',
   '2FA disabled',
   'Two-factor authentication has been turned off. If this wasn''t you, contact support.',
   '{"username":"string"}',
   true, 1, NOW(), NOW())
ON CONFLICT (code, channel, locale) DO NOTHING;
