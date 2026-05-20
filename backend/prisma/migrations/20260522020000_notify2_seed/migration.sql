-- PR-NOTIFY-2: SES driver + suppression list + expanded event family.

CREATE TYPE "EmailSuppressionReason" AS ENUM ('HARD_BOUNCE', 'COMPLAINT', 'MANUAL');

CREATE TABLE "EmailSuppression" (
  "email"     text                       PRIMARY KEY,
  "reason"    "EmailSuppressionReason"   NOT NULL,
  "subtype"   text,
  "metadata"  jsonb,
  "createdAt" timestamp(3)               NOT NULL DEFAULT NOW()
);
CREATE INDEX "EmailSuppression_reason_createdAt_idx"
  ON "EmailSuppression" ("reason", "createdAt");

-- New notification templates for the full event family. Each is shipped
-- in EMAIL + INAPP channels; PUSH carbon-copies inherit subject/body
-- from the EMAIL row at render time.

INSERT INTO "NotificationTemplate" (id, code, channel, locale, subject, body, variables, active, version, "updatedAt", "createdAt")
VALUES
  -- Auction won
  ('tpl-auction-won-v1-email-en',
   'auction_won_v1', 'EMAIL', 'en',
   'You won! {{auctionTitle}}',
   $$Congratulations — you placed the winning bid on {{auctionTitle}}.

We'll ship it to your saved address. Track the order at /me/orders/{{orderId}}.

— Kalki Auctions$$,
   '{"username":"string","auctionTitle":"string","orderId":"string"}',
   true, 1, NOW(), NOW()),
  ('tpl-auction-won-v1-inapp-en',
   'auction_won_v1', 'INAPP', 'en',
   'You won {{auctionTitle}}!',
   $$Tap to track shipping.$$,
   '{"username":"string","auctionTitle":"string","orderId":"string"}',
   true, 1, NOW(), NOW()),

  -- Withdrawal approved
  ('tpl-withdrawal-approved-v1-email-en',
   'withdrawal_approved_v1', 'EMAIL', 'en',
   'Withdrawal approved — {{amountCoins}} coins',
   $$Your withdrawal of {{amountCoins}} coins ({{amountInr}}) has been approved and queued for transfer to your saved bank account.

Reference: {{txnRef}}

— Kalki$$,
   '{"username":"string","amountCoins":"string","amountInr":"string","txnRef":"string"}',
   true, 1, NOW(), NOW()),
  ('tpl-withdrawal-approved-v1-inapp-en',
   'withdrawal_approved_v1', 'INAPP', 'en',
   'Withdrawal approved',
   $${{amountCoins}} coins approved — ref {{txnRef}}.$$,
   '{"username":"string","amountCoins":"string","amountInr":"string","txnRef":"string"}',
   true, 1, NOW(), NOW()),

  -- Withdrawal rejected
  ('tpl-withdrawal-rejected-v1-email-en',
   'withdrawal_rejected_v1', 'EMAIL', 'en',
   'Withdrawal request needs your attention',
   $$Your withdrawal of {{amountCoins}} coins could not be processed: {{reason}}.

Coins have been returned to your wallet. Resubmit at /me/withdrawals once the issue is resolved, or reply to this email for support.$$,
   '{"username":"string","amountCoins":"string","reason":"string"}',
   true, 1, NOW(), NOW()),
  ('tpl-withdrawal-rejected-v1-inapp-en',
   'withdrawal_rejected_v1', 'INAPP', 'en',
   'Withdrawal needs attention',
   $${{amountCoins}} coins refunded — reason: {{reason}}.$$,
   '{"username":"string","amountCoins":"string","reason":"string"}',
   true, 1, NOW(), NOW()),

  -- Top-up succeeded
  ('tpl-topup-succeeded-v1-email-en',
   'topup_succeeded_v1', 'EMAIL', 'en',
   'Coins added — {{amountCoins}} coins',
   $$Your top-up of {{amountInr}} ({{amountCoins}} coins) is complete.

Order ID: {{orderId}}

— Kalki$$,
   '{"username":"string","amountCoins":"string","amountInr":"string","orderId":"string"}',
   true, 1, NOW(), NOW()),
  ('tpl-topup-succeeded-v1-inapp-en',
   'topup_succeeded_v1', 'INAPP', 'en',
   '{{amountCoins}} coins added',
   $$Top-up complete — order {{orderId}}.$$,
   '{"username":"string","amountCoins":"string","amountInr":"string","orderId":"string"}',
   true, 1, NOW(), NOW()),

  -- KYC state changed
  ('tpl-kyc-state-changed-v1-email-en',
   'kyc_state_changed_v1', 'EMAIL', 'en',
   'KYC update on your Kalki account',
   $$Your KYC tier has changed to {{newTier}}.

{{message}}

Manage your KYC documents at /me/kyc.$$,
   '{"username":"string","newTier":"string","message":"string"}',
   true, 1, NOW(), NOW()),
  ('tpl-kyc-state-changed-v1-inapp-en',
   'kyc_state_changed_v1', 'INAPP', 'en',
   'KYC: now {{newTier}}',
   $${{message}}$$,
   '{"username":"string","newTier":"string","message":"string"}',
   true, 1, NOW(), NOW()),

  -- Referral qualified
  ('tpl-referral-qualified-v1-email-en',
   'referral_qualified_v1', 'EMAIL', 'en',
   'Your referral just qualified — {{coins}} coins on the way',
   $${{refereeUsername}} qualified for the referral bonus. {{coins}} coins are queued for your wallet.$$,
   '{"username":"string","refereeUsername":"string","coins":"string"}',
   true, 1, NOW(), NOW()),
  ('tpl-referral-qualified-v1-inapp-en',
   'referral_qualified_v1', 'INAPP', 'en',
   'Referral bonus pending',
   $${{refereeUsername}} qualified — {{coins}} coins coming.$$,
   '{"username":"string","refereeUsername":"string","coins":"string"}',
   true, 1, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
