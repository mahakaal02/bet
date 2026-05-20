-- =====================================================================
--  Foundation migration — the cross-cutting plumbing every follow-up
--  production-feature PR builds on top of. See
--  `docs/PRODUCTION_ROADMAP.md` for the design rationale.
--
--  Scope (additive only):
--    - Adds new RBAC enum + role grant table
--    - Adds feature-flag + runtime-settings tables
--    - Adds admin audit log
--    - Adds outbox + notification subsystems
--    - Adds watchlist, shipping address, order tracking
--    - Adds referral, KYC, responsible-gambling, support tickets
--    - Adds auth helpers (password reset, 2FA, email change, deletion)
--    - Adds user-export + daily-login tables
--    - Adds 8 new optional columns to "User" (display name, avatar,
--      legal name, referral code, ban state, password change anchor)
--
--  Out of scope (handled in separate drift-fix PRs):
--    - The existing schema-vs-DB drift on PaymentOrder/PhoneOtp/User.
--      Those changes live in schema.prisma but were never materialised,
--      and patching them needs its own coordinated PR with rollout
--      review. We deliberately do NOT bundle them here.
--
--  Idempotency:
--    - Every `CREATE TABLE` and `CREATE INDEX` runs only once on a
--      fresh DB. The init container's stuck-migration cleanup (added
--      in PR #27) handles the case where a prior attempt of this same
--      migration was rolled back mid-flight.
--    - The User ADD COLUMN block uses `IF NOT EXISTS` so an
--      environment that already added some of those columns via
--      `db push --accept-data-loss` survives unchanged.

-- ════════════════════════════════════════════════════════════════════
--  User column additions — additive, IF NOT EXISTS guarded
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "displayName"       TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarKey"         TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "legalName"         TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referralCode"      TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bannedAt"          TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bannedReason"      TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bannedBy"          TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3);

-- Unique index for referralCode (NULLable column — multi-NULL is fine
-- in Postgres unique indexes, so existing users get NULL and one
-- referral code each going forward).
CREATE UNIQUE INDEX IF NOT EXISTS "User_referralCode_key"
  ON "User" ("referralCode");

-- ════════════════════════════════════════════════════════════════════
--  Foundation tables — generated from schema.prisma via `prisma
--  migrate diff`, then hand-filtered to drop drift entanglement
-- ════════════════════════════════════════════════════════════════════

CREATE TYPE "Role" AS ENUM ('ADMIN', 'MODERATOR', 'FINANCE', 'SUPPORT', 'AUDITOR');

-- CreateEnum
CREATE TYPE "FlagMode" AS ENUM ('BOOLEAN', 'ROLE', 'PERCENT');

-- CreateEnum
CREATE TYPE "SettingType" AS ENUM ('INT', 'FLOAT', 'STRING', 'BOOL', 'JSON');

-- CreateEnum
CREATE TYPE "OutboxKind" AS ENUM ('BET_WALLET_DEBIT', 'BET_WALLET_CREDIT', 'FCM_PUSH', 'SES_EMAIL', 'RAZORPAY_REFUND', 'ADMIN_AUDIT_REPLAY');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'IN_FLIGHT', 'COMPLETED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'EMAIL', 'INAPP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'RENDERED', 'SENT', 'DELIVERED', 'FAILED', 'RETRY', 'DEAD');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_ADDRESS', 'AWAITING_FULFILLMENT', 'IN_TRANSIT', 'DELIVERED', 'DISPUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'QUALIFIED', 'PAID', 'VOIDED');

-- CreateEnum
CREATE TYPE "KycTier" AS ENUM ('TIER_0', 'TIER_1', 'TIER_2', 'TIER_3');

-- CreateEnum
CREATE TYPE "ReviewState" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED', 'REQUIRES_RESUBMIT');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('PAN', 'AADHAAR_LAST4', 'PASSPORT', 'VOTER_ID', 'ADDRESS_PROOF', 'SELFIE', 'LIVENESS_VIDEO');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "RgEventKind" AS ENUM ('DEPOSIT_BLOCKED_BY_LIMIT', 'BET_BLOCKED_BY_LIMIT', 'LOSS_LIMIT_REACHED', 'SESSION_REMINDER_SHOWN', 'COOLDOWN_STARTED', 'COOLDOWN_ENDED', 'SELF_EXCLUSION_STARTED', 'SELF_EXCLUSION_ENDED');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'AWAITING_USER', 'AWAITING_ADMIN', 'ESCALATED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('ACCOUNT', 'WITHDRAWAL', 'DEPOSIT', 'BIDDING', 'AVIATOR', 'ORDER_FULFILLMENT', 'TECHNICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "TicketCloseReason" AS ENUM ('RESOLVED', 'DUPLICATE', 'INVALID', 'NO_RESPONSE');

-- CreateEnum
CREATE TYPE "ExportKind" AS ENUM ('TRADE_HISTORY', 'WALLET_LEDGER', 'BID_HISTORY');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('QUEUED', 'RUNNING', 'READY', 'FAILED', 'EXPIRED');
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "grantedBy" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","role")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "mode" "FlagMode" NOT NULL DEFAULT 'BOOLEAN',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "roles" "Role"[] DEFAULT ARRAY[]::"Role"[],
    "rolloutPercent" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "valueType" "SettingType" NOT NULL,
    "description" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SystemSettingHistory" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemSettingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outbox" (
    "id" TEXT NOT NULL,
    "kind" "OutboxKind" NOT NULL,
    "sourceTable" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "templateCode" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "rendered" JSONB,
    "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "campaignId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "outbid" BOOLEAN NOT NULL DEFAULT true,
    "auctionEnding" BOOLEAN NOT NULL DEFAULT true,
    "orderUpdates" BOOLEAN NOT NULL DEFAULT true,
    "dailyStreak" BOOLEAN NOT NULL DEFAULT true,
    "marketingPush" BOOLEAN NOT NULL DEFAULT false,
    "marketingEmail" BOOLEAN NOT NULL DEFAULT true,
    "responsibleGambling" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "lastNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingAddress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "countryIso2" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "winnerId" TEXT NOT NULL,
    "shippingAddressId" TEXT,
    "shippingAddressSnapshot" JSONB,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_ADDRESS',
    "fulfillmentNotes" TEXT,
    "carrierName" TEXT,
    "trackingNumber" TEXT,
    "trackingUrl" TEXT,
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "deliveredBy" TEXT,
    "disputedAt" TIMESTAMP(3),
    "disputeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralClaim" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "refereeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "qualifiedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "referrerRewardCoins" INTEGER NOT NULL,
    "refereeRewardCoins" INTEGER NOT NULL,
    "refereeSignupIp" TEXT,
    "refereeSignupDeviceHash" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" "KycTier" NOT NULL DEFAULT 'TIER_0',
    "emailVerifiedAt" TIMESTAMP(3),
    "phoneVerifiedAt" TIMESTAMP(3),
    "identityVerifiedAt" TIMESTAMP(3),
    "addressVerifiedAt" TIMESTAMP(3),
    "reviewState" "ReviewState" NOT NULL DEFAULT 'NONE',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycDocument" (
    "id" TEXT NOT NULL,
    "kycId" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "virusScanStatus" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "ocrText" TEXT,
    "reviewState" "ReviewState" NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "reviewNotes" TEXT,
    "encryptionKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResponsibleGamblingProfile" (
    "userId" TEXT NOT NULL,
    "dailyDepositLimitCoins" INTEGER,
    "weeklyDepositLimitCoins" INTEGER,
    "monthlyDepositLimitCoins" INTEGER,
    "dailyLossLimitCoins" INTEGER,
    "weeklyLossLimitCoins" INTEGER,
    "monthlyLossLimitCoins" INTEGER,
    "dailyWagerLimitCoins" INTEGER,
    "sessionReminderMinutes" INTEGER NOT NULL DEFAULT 30,
    "cooldownUntil" TIMESTAMP(3),
    "selfExcludedUntil" TIMESTAMP(3),
    "selfExcludedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResponsibleGamblingProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ResponsibleGamblingEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "RgEventKind" NOT NULL,
    "amount" INTEGER,
    "limitKind" TEXT,
    "limitValue" INTEGER,
    "sessionDurationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResponsibleGamblingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "category" "TicketCategory" NOT NULL,
    "slaDueAt" TIMESTAMP(3) NOT NULL,
    "firstResponseAt" TIMESTAMP(3),
    "linkedEntityType" TEXT,
    "linkedEntityId" TEXT,
    "assignedToId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedReason" "TicketCloseReason",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "isFromAdmin" BOOLEAN NOT NULL,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "virusScanStatus" "ScanStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "SupportAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfileHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserProfileHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "requestedIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwoFactorAuth" (
    "userId" TEXT NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "backupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabledAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TwoFactorAuth_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "TrustedDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceHash" TEXT NOT NULL,
    "label" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrustedDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailChangeRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "oldEmail" TEXT NOT NULL,
    "newEmail" TEXT NOT NULL,
    "oldTokenHash" TEXT NOT NULL,
    "newTokenHash" TEXT NOT NULL,
    "oldConfirmedAt" TIMESTAMP(3),
    "newConfirmedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountDeletion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "AccountDeletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserExport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ExportKind" NOT NULL,
    "filters" JSONB NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'QUEUED',
    "rowCount" INTEGER,
    "fileKey" TEXT,
    "fileSizeBytes" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataExportRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileKey" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'QUEUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataExportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyLogin" (
    "userId" TEXT NOT NULL,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "lastClaimAt" TIMESTAMP(3),
    "streakFreezes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyLogin_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "DailyLoginClaim" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dayNumber" INTEGER NOT NULL,
    "rewardCoins" INTEGER NOT NULL,
    "claimDateUtc" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyLoginClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpersonationLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "actions" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "ImpersonationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserRole_role_revokedAt_idx" ON "UserRole"("role", "revokedAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_actorId_createdAt_idx" ON "AdminAuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_targetType_targetId_createdAt_idx" ON "AdminAuditLog"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_action_createdAt_idx" ON "AdminAuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_correlationId_idx" ON "AdminAuditLog"("correlationId");

-- CreateIndex
CREATE INDEX "SystemSettingHistory_key_changedAt_idx" ON "SystemSettingHistory"("key", "changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Outbox_idempotencyKey_key" ON "Outbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Outbox_status_nextAttemptAt_idx" ON "Outbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "Outbox_sourceTable_sourceId_idx" ON "Outbox"("sourceTable", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_code_channel_locale_key" ON "NotificationTemplate"("code", "channel", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_idempotencyKey_key" ON "Notification"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Notification_userId_status_createdAt_idx" ON "Notification"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_campaignId_idx" ON "Notification"("campaignId");

-- CreateIndex
CREATE INDEX "Watchlist_auctionId_idx" ON "Watchlist"("auctionId");

-- CreateIndex
CREATE UNIQUE INDEX "Watchlist_userId_auctionId_key" ON "Watchlist"("userId", "auctionId");

-- CreateIndex
CREATE INDEX "ShippingAddress_userId_deletedAt_idx" ON "ShippingAddress"("userId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_auctionId_key" ON "Order"("auctionId");

-- CreateIndex
CREATE INDEX "Order_winnerId_status_idx" ON "Order"("winnerId", "status");

-- CreateIndex
CREATE INDEX "Order_status_updatedAt_idx" ON "Order"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralClaim_refereeId_key" ON "ReferralClaim"("refereeId");

-- CreateIndex
CREATE INDEX "ReferralClaim_referrerId_status_idx" ON "ReferralClaim"("referrerId", "status");

-- CreateIndex
CREATE INDEX "ReferralClaim_code_idx" ON "ReferralClaim"("code");

-- CreateIndex
CREATE UNIQUE INDEX "KycVerification_userId_key" ON "KycVerification"("userId");

-- CreateIndex
CREATE INDEX "KycVerification_tier_idx" ON "KycVerification"("tier");

-- CreateIndex
CREATE INDEX "KycVerification_reviewState_updatedAt_idx" ON "KycVerification"("reviewState", "updatedAt");

-- CreateIndex
CREATE INDEX "KycDocument_kycId_kind_idx" ON "KycDocument"("kycId", "kind");

-- CreateIndex
CREATE INDEX "KycDocument_reviewState_createdAt_idx" ON "KycDocument"("reviewState", "createdAt");

-- CreateIndex
CREATE INDEX "ResponsibleGamblingEvent_userId_createdAt_idx" ON "ResponsibleGamblingEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ResponsibleGamblingEvent_kind_createdAt_idx" ON "ResponsibleGamblingEvent"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_status_slaDueAt_idx" ON "SupportTicket"("status", "slaDueAt");

-- CreateIndex
CREATE INDEX "SupportTicket_assignedToId_status_idx" ON "SupportTicket"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "SupportTicket_userId_createdAt_idx" ON "SupportTicket"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportMessage_ticketId_createdAt_idx" ON "SupportMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "UserProfileHistory_userId_changedAt_idx" ON "UserProfileHistory"("userId", "changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordReset_userId_usedAt_idx" ON "PasswordReset"("userId", "usedAt");

-- CreateIndex
CREATE INDEX "TrustedDevice_userId_expiresAt_idx" ON "TrustedDevice"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrustedDevice_userId_deviceHash_key" ON "TrustedDevice"("userId", "deviceHash");

-- CreateIndex
CREATE UNIQUE INDEX "EmailChangeRequest_oldTokenHash_key" ON "EmailChangeRequest"("oldTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "EmailChangeRequest_newTokenHash_key" ON "EmailChangeRequest"("newTokenHash");

-- CreateIndex
CREATE INDEX "EmailChangeRequest_userId_idx" ON "EmailChangeRequest"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountDeletion_userId_key" ON "AccountDeletion"("userId");

-- CreateIndex
CREATE INDEX "UserExport_userId_createdAt_idx" ON "UserExport"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserExport_status_createdAt_idx" ON "UserExport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DataExportRequest_userId_status_idx" ON "DataExportRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "DailyLoginClaim_userId_claimDateUtc_idx" ON "DailyLoginClaim"("userId", "claimDateUtc");

-- CreateIndex
CREATE UNIQUE INDEX "DailyLoginClaim_userId_claimDateUtc_key" ON "DailyLoginClaim"("userId", "claimDateUtc");

-- AddForeignKey

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingAddress" ADD CONSTRAINT "ShippingAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_shippingAddressId_fkey" FOREIGN KEY ("shippingAddressId") REFERENCES "ShippingAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralClaim" ADD CONSTRAINT "ReferralClaim_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralClaim" ADD CONSTRAINT "ReferralClaim_refereeId_fkey" FOREIGN KEY ("refereeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycVerification" ADD CONSTRAINT "KycVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_kycId_fkey" FOREIGN KEY ("kycId") REFERENCES "KycVerification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibleGamblingProfile" ADD CONSTRAINT "ResponsibleGamblingProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibleGamblingEvent" ADD CONSTRAINT "ResponsibleGamblingEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAttachment" ADD CONSTRAINT "SupportAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "SupportMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProfileHistory" ADD CONSTRAINT "UserProfileHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TwoFactorAuth" ADD CONSTRAINT "TwoFactorAuth_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedDevice" ADD CONSTRAINT "TrustedDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailChangeRequest" ADD CONSTRAINT "EmailChangeRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountDeletion" ADD CONSTRAINT "AccountDeletion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserExport" ADD CONSTRAINT "UserExport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataExportRequest" ADD CONSTRAINT "DataExportRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLogin" ADD CONSTRAINT "DailyLogin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLoginClaim" ADD CONSTRAINT "DailyLoginClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationLog" ADD CONSTRAINT "ImpersonationLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationLog" ADD CONSTRAINT "ImpersonationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

