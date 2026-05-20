-- Seed: daily-login streak — notification template + reward catalog.
--
-- The catalog lives in SystemSetting so an admin can tweak rewards
-- via the Settings UI (PR-SETTINGS-1) without a redeploy. The default
-- table follows Roadmap §F-USER-8 — 50 / 75 / 100 ramp, 300-coin
-- "first-week" bonus on day 7, 700 on day 14, 2000 "loyalty" on day
-- 30. Days not in the table interpolate linearly (handled in
-- DailyLoginService.rewardForDay).
--
-- The notification template is INAPP only — push would spam users
-- on background auto-claim flows that may land here later.

INSERT INTO "SystemSetting" (key, value, "valueType", description, "updatedAt", "createdAt")
VALUES
  ('daily_login.rewards',
   $$[
     {"day": 1, "coins": 50},
     {"day": 2, "coins": 75},
     {"day": 3, "coins": 100},
     {"day": 7, "coins": 300, "bonus": "first_week"},
     {"day": 14, "coins": 700},
     {"day": 30, "coins": 2000, "bonus": "loyalty"}
   ]$$::jsonb,
   'JSON',
   'Daily-login reward table. Each entry is { day, coins, bonus? }. Days not listed are linearly interpolated between the surrounding declared days. Caps at the last declared day for any day beyond it.',
   NOW(), NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO "NotificationTemplate" (id, code, channel, locale, subject, body, variables, active, version, "updatedAt", "createdAt")
VALUES
  ('tpl-daily-streak-v1-inapp-en',
   'daily_streak_v1',
   'INAPP',
   'en',
   'Day {{dayNumber}} reward claimed',
   'You picked up {{rewardCoins}} coins for day {{dayNumber}} of your streak. Keep coming back daily to grow your reward.',
   '{"dayNumber":"string","rewardCoins":"string","bonus":"string"}',
   true, 1, NOW(), NOW())
ON CONFLICT (code, channel, locale) DO NOTHING;
