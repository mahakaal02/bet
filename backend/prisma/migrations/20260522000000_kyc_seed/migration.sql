-- Seed: KYC settings catalog (PR-KYC-1).
--
-- The tier-vs-withdrawal table lives in SystemSetting so support /
-- finance can re-tune ceilings without a redeploy (e.g. raise tier-2
-- to 1L on a regulatory change). `-1` is the "unlimited" sentinel
-- (only meaningful for tier 3).
--
-- `kyc.tier_floor` gates withdrawal entirely below that tier — set
-- to TIER_1 by default so a fresh signup can bid but not cash out
-- until phone+email are verified.

INSERT INTO "SystemSetting" (key, value, "valueType", description, "updatedAt", "createdAt")
VALUES
  ('kyc.tier_floor',
   '"TIER_1"'::jsonb, 'STRING',
   'Minimum KYC tier required to withdraw at all. Below this, KycService.withdrawalEligibility() refuses with reason=kyc_below_<tier>.',
   NOW(), NOW()),
  ('kyc.tier_0_max_withdrawal_coins',
   '0'::jsonb, 'INT',
   'Max withdrawal in coins for TIER_0 (signup-only). Always 0 unless deliberately enabling pre-KYC payouts.',
   NOW(), NOW()),
  ('kyc.tier_1_max_withdrawal_coins',
   '5000'::jsonb, 'INT',
   'Max withdrawal in coins for TIER_1 (email+phone verified). Low ceiling — incentive to complete TIER_2.',
   NOW(), NOW()),
  ('kyc.tier_2_max_withdrawal_coins',
   '50000'::jsonb, 'INT',
   'Max withdrawal in coins for TIER_2 (identity doc approved). 5x tier-1 ceiling.',
   NOW(), NOW()),
  ('kyc.tier_3_max_withdrawal_coins',
   '-1'::jsonb, 'INT',
   'Max withdrawal in coins for TIER_3 (full KYC + selfie + address). -1 = unlimited.',
   NOW(), NOW()),
  ('kyc.max_document_bytes',
   '10485760'::jsonb, 'INT',
   '10 MiB per-document cap. Service-layer parity with the controller-level Multer cap; raising one without the other does nothing.',
   NOW(), NOW())
ON CONFLICT (key) DO NOTHING;

-- Feature flag: shipping the KYC machinery dark until the admin
-- review queue (PR-KYC-2) lands. Until enabled, the controller still
-- works (so QA can run end-to-end), but Bet's wallet treats every
-- user as "eligible" without consulting the tier system.
INSERT INTO "FeatureFlag" (id, enabled, description, "updatedAt", "createdAt")
VALUES
  ('kyc.enabled',
   false,
   'When ON, Bet wallet calls /me/kyc/withdrawal-eligibility before issuing withdrawals. Flip after PR-KYC-2 ships the admin review queue.',
   NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
