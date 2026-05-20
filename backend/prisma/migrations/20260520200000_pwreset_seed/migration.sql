-- Seed: notification templates for the password-reset flow.
--
--   password_reset_v1       — sent on `request`. Carries the
--                              one-time reset link.
--   password_changed_v1     — sent on `confirm`. The "your password
--                              was just changed" safety net so the
--                              legitimate user notices a stolen
--                              token reset even if the attacker
--                              succeeded.
--
-- Both templates ship per-channel rows; the service decides which
-- channels to dispatch through. The reset link is EMAIL-only by
-- design (a push notification carrying the token would let anyone
-- who picks up the device hijack the reset).
--
-- ON CONFLICT DO NOTHING — re-running is safe.

INSERT INTO "NotificationTemplate" (id, code, channel, locale, subject, body, variables, active, version, "updatedAt", "createdAt")
VALUES
  -- password_reset_v1 — EMAIL
  ('tpl-pwreset-v1-email-en',
   'password_reset_v1',
   'EMAIL',
   'en',
   'Reset your Kalki password',
   $$Hi {{username}},

We received a request to reset the password for your Kalki account. If that wasn't you, you can ignore this email — no action is needed.

Otherwise, open this link to set a new password (valid for {{expiresInMinutes}} minutes, one use only):

{{resetUrl}}

— Kalki Auctions$$,
   '{"resetUrl":"string","username":"string","expiresInMinutes":"string"}',
   true, 1, NOW(), NOW()),

  -- password_changed_v1 — EMAIL
  ('tpl-pwchanged-v1-email-en',
   'password_changed_v1',
   'EMAIL',
   'en',
   'Your Kalki password was changed',
   $$Hi {{username}},

Your Kalki account password was just changed. All existing sessions have been signed out.

If this wasn't you, contact support immediately — your account may be compromised.

— Kalki Auctions$$,
   '{"username":"string"}',
   true, 1, NOW(), NOW()),

  -- password_changed_v1 — PUSH
  ('tpl-pwchanged-v1-push-en',
   'password_changed_v1',
   'PUSH',
   'en',
   'Password changed',
   'Your Kalki password was just changed. If this wasn''t you, open the app and contact support.',
   '{"username":"string"}',
   true, 1, NOW(), NOW()),

  -- password_changed_v1 — INAPP
  ('tpl-pwchanged-v1-inapp-en',
   'password_changed_v1',
   'INAPP',
   'en',
   'Password changed',
   'Your password was just changed. All sessions have been signed out. If this wasn''t you, contact support.',
   '{"username":"string"}',
   true, 1, NOW(), NOW())
ON CONFLICT (code, channel, locale) DO NOTHING;
