-- Seed: the runtime-settings catalog.
--
-- Each row replaces a previously env-driven or hard-coded constant
-- with a `SystemSetting` row the admin Settings page can edit.
-- Until a row is set, `SettingsService` falls back to the same env
-- var (translated dotted-key → SHOUTING_SNAKE) and then to a
-- per-call default, so existing prod boxes keep working until the
-- row is inserted.
--
-- Catalog matches `docs/PRODUCTION_ROADMAP.md` §1F. Defaults match
-- the literal values currently shipped in code (e.g.
-- withdrawal-min = 2000 coins from PR #21).
--
-- ON CONFLICT DO NOTHING — re-running is safe and never overwrites
-- an admin-set value.

INSERT INTO "SystemSetting" (key, value, "valueType", description, "updatedAt", "createdAt")
VALUES
  -- Wallet & payments
  ('wallet.withdraw_min_coins',
   '2000'::jsonb, 'INT',
   'Minimum withdrawal amount in coins. Critical — withdrawal flow on auctions/bet/aviator reads this. Change requires a careful review of all three surfaces.',
   NOW(), NOW()),
  ('wallet.topup_min_coins',
   '100'::jsonb, 'INT',
   'Minimum top-up amount in coins per Razorpay order. Lower values risk net-loss after gateway fees.',
   NOW(), NOW()),
  ('wallet.signup_bonus_coins',
   '10000'::jsonb, 'INT',
   'New-account welcome bonus in coins. Granted once at user creation. Reducing does not retroactively claw back.',
   NOW(), NOW()),

  -- Aviator
  ('aviator.min_bet_coins',
   '100'::jsonb, 'INT',
   'Minimum bet per Aviator round. Floors the bet input on the crash game.',
   NOW(), NOW()),
  ('aviator.max_bet_coins',
   '10000'::jsonb, 'INT',
   'Maximum bet per Aviator round. Caps single-round exposure; useful for responsible-gambling rollouts.',
   NOW(), NOW()),
  ('aviator.betting_window_ms',
   '10000'::jsonb, 'INT',
   'Pre-round betting window in milliseconds. Shorter = faster cadence, higher rounds-per-hour.',
   NOW(), NOW()),

  -- Auctions
  ('auctions.max_concurrent_bids_per_user',
   '10'::jsonb, 'INT',
   'Per-user soft cap on bids placed within a 1-minute sliding window. Anti-spam.',
   NOW(), NOW()),

  -- Referral programme
  ('referral.bonus_referrer_coins',
   '500'::jsonb, 'INT',
   'Reward paid to the referrer when their referee qualifies. Snapshot at claim time so this can change without back-dating in-flight claims.',
   NOW(), NOW()),
  ('referral.bonus_referee_coins',
   '1000'::jsonb, 'INT',
   'Sign-up bonus paid to the referee (the new user) when they qualify.',
   NOW(), NOW()),

  -- Responsible gambling defaults
  ('rg.default_daily_loss_limit_coins',
   '50000'::jsonb, 'INT',
   'Default daily loss limit for new accounts. Users can lower (instant) or raise (24h cool-off) via the RG settings page once shipped (PR-RG-1).',
   NOW(), NOW()),

  -- KYC tier withdrawal caps (compliance-sensitive — two-admin in UI)
  ('kyc.tier1_daily_withdraw_max_coins',
   '5000'::jsonb, 'INT',
   'Daily withdrawal cap for KYC Tier 1 (email-verified only). Compliance-sensitive — raising this widens platform exposure to unverified accounts.',
   NOW(), NOW()),
  ('kyc.tier2_daily_withdraw_max_coins',
   '50000'::jsonb, 'INT',
   'Daily withdrawal cap for KYC Tier 2 (PAN + ID-proof verified). Compliance-sensitive.',
   NOW(), NOW()),
  ('kyc.tier3_daily_withdraw_max_coins',
   '500000'::jsonb, 'INT',
   'Daily withdrawal cap for KYC Tier 3 (full KYC + address proof + selfie). Compliance-sensitive.',
   NOW(), NOW())
ON CONFLICT (key) DO NOTHING;
