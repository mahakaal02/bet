-- PR-REFERRAL-1: SystemSetting catalog for referral rewards + the
-- qualification gates. All editable via the admin Settings UI so
-- ops can re-tune incentives without a redeploy.

INSERT INTO "SystemSetting" (key, value, "valueType", description, "updatedAt", "createdAt")
VALUES
  ('referral.referrer_reward_coins',
   '500'::jsonb, 'INT',
   'Coins credited to the referrer when their referee qualifies. Held in pendingLimits-style until both KYC + first-deposit gates are crossed.',
   NOW(), NOW()),
  ('referral.referee_reward_coins',
   '250'::jsonb, 'INT',
   'Coins credited to the referee on qualification. Lower than the referrer cut to dampen incentive for self-referral via secondary accounts.',
   NOW(), NOW()),
  ('referral.qualification_deposit_min_coins',
   '1000'::jsonb, 'INT',
   'Minimum total coins the referee must purchase (lifetime sum of razorpay_purchase CoinTransactions) before the referral qualifies. Higher = stronger anti-fraud, lower = faster payout.',
   NOW(), NOW())
ON CONFLICT (key) DO NOTHING;
