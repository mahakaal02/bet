-- PR-AVIATOR-PAYOUT-CAP — per-bet settlement-side payout ceiling.
--
-- All three AviatorBet columns are nullable / default false so existing
-- rows stay valid without backfill. Online ALTER on Postgres 11+ for
-- nullable / default-constant adds — no exclusive lock, no rewrite.
--
-- Rollback path (only if the engine ships broken): the helper code in
-- payout-cap.ts treats `enabled=false / maxCoins<=0 / null` as no-op,
-- so DELETE-ing the two SystemSetting rows is enough to revert
-- behaviour. The three AviatorBet columns can stay (no data loss);
-- drop in a follow-up migration if truly unwanted.

ALTER TABLE "AviatorBet"
  ADD COLUMN IF NOT EXISTS "originalPayoutCoins" INTEGER;

ALTER TABLE "AviatorBet"
  ADD COLUMN IF NOT EXISTS "payoutCapCoins" INTEGER;

ALTER TABLE "AviatorBet"
  ADD COLUMN IF NOT EXISTS "cappedByPayoutCap" BOOLEAN NOT NULL DEFAULT false;

-- SystemSetting rows. ON CONFLICT DO NOTHING so a re-run never
-- overwrites an admin's edited cap value (cap of 20 000 is the
-- documented default — operators may legitimately have tuned it
-- via the admin panel before this migration re-ran on a pod restart).
INSERT INTO "SystemSetting" (key, value, "valueType", description, "updatedAt", "createdAt")
VALUES
  ('aviator.payout_cap.enabled',
   'true'::jsonb, 'BOOL',
   'Master switch for the per-bet payout cap. When true (default), every Aviator cashout is clipped at aviator.payout_cap.max_coins; the round and other players are unaffected. When false, payouts are uncapped — strongly discouraged in production: see warning in admin UI.',
   NOW(), NOW()),

  ('aviator.payout_cap.max_coins',
   '20000'::jsonb, 'INT',
   'Maximum payout per bet, in integer coins (= INR on this platform). Default 20 000 INR. Set to 1 or higher; values <= 0 are coerced to the default for safety. Snapshot once per round at BETTING-phase start, so admin edits take effect on the NEXT round (existing bets keep the cap they were placed under).',
   NOW(), NOW())
ON CONFLICT (key) DO NOTHING;
