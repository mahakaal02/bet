-- RECONCILE-HISTORY — realign the backend migration history with
-- backend/prisma/schema.prisma.
--
-- Historically several schema changes were applied with `prisma db push`
-- and committed without a matching migration directory. As a result a DB
-- rebuilt purely from `prisma migrate deploy` (an empty database replaying
-- every migration) ends up MISSING real columns/tables/constraints that
-- the schema — and the Prisma client the seed uses — expect. On such a DB
-- `prisma/seed.ts` dies with P2022 ("User.phoneVerified does not exist"),
-- and the next developer to run `prisma migrate dev` is handed a surprise
-- auto-generated drift migration.
--
-- This is the exact delta reported by
--   prisma migrate diff \
--     --from-migrations ./prisma/migrations \
--     --to-schema-datamodel ./prisma/schema.prisma --script
-- captured against a scratch shadow DB. It is NOT breaking prod: the live
-- cluster was `db push`-synced at some point and already has every object
-- below, so each statement here is a guarded no-op there. It only matters
-- when rebuilding a database from the migration chain alone.
--
-- Every statement is idempotent (IF [NOT] EXISTS, existence-guarded DO
-- blocks, DROP-then-ADD for constraints) so it applies cleanly on a fresh
-- migrate-deploy DB AND re-applies as a no-op on the already-synced
-- cluster.

-- ── PaymentOrderKind enum (gates the PaymentOrder.kind column below) ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentOrderKind') THEN
    CREATE TYPE "PaymentOrderKind" AS ENUM ('COIN_PACK', 'WALLET_TOPUP');
  END IF;
END $$;

-- ── User: phone-login + WhatsApp fields; drop the legacy demoBalance;
--    email is now optional (phone-only accounts). ──
ALTER TABLE "User" DROP COLUMN IF EXISTS "demoBalance";
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phoneVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "whatsappPhone" TEXT;
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "User_whatsappPhone_key" ON "User"("whatsappPhone");

-- ── PaymentOrder: wallet top-ups vs coin packs (kind), coinPackId now
--    optional (top-ups have no pack), coins defaults to 0. ──
ALTER TABLE "PaymentOrder" ADD COLUMN IF NOT EXISTS "kind" "PaymentOrderKind" NOT NULL DEFAULT 'COIN_PACK';
ALTER TABLE "PaymentOrder" ALTER COLUMN "coinPackId" DROP NOT NULL;
ALTER TABLE "PaymentOrder" ALTER COLUMN "coins" SET DEFAULT 0;

-- ── Misc column defaults that drifted from the datamodel. ──
ALTER TABLE "Auction" ALTER COLUMN "status" SET DEFAULT 'UPCOMING';
ALTER TABLE "PromoCode" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- ── PhoneOtp: OTP store for phone login. ──
CREATE TABLE IF NOT EXISTS "PhoneOtp" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "username" TEXT,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhoneOtp_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PhoneOtp_phone_createdAt_idx" ON "PhoneOtp"("phone", "createdAt" DESC);

-- ── ImpersonationLog lookup indexes. ──
CREATE INDEX IF NOT EXISTS "ImpersonationLog_adminId_startedAt_idx" ON "ImpersonationLog"("adminId", "startedAt");
CREATE INDEX IF NOT EXISTS "ImpersonationLog_userId_startedAt_idx" ON "ImpersonationLog"("userId", "startedAt");

-- ── Foreign keys whose ON DELETE behavior drifted from the datamodel.
--    DROP-then-ADD (rather than a guarded ADD) so the referential action
--    is actually corrected on a fresh-deploy DB where the constraint
--    already exists with the old behavior, while staying a no-op on the
--    cluster (drop the identical constraint, re-add it identically). ──
ALTER TABLE "PaymentOrder" DROP CONSTRAINT IF EXISTS "PaymentOrder_coinPackId_fkey";
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_coinPackId_fkey" FOREIGN KEY ("coinPackId") REFERENCES "CoinPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_auctionId_fkey";
ALTER TABLE "Order" ADD CONSTRAINT "Order_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReconciliationDiscrepancy" DROP CONSTRAINT IF EXISTS "ReconciliationDiscrepancy_reportId_fkey";
ALTER TABLE "ReconciliationDiscrepancy" ADD CONSTRAINT "ReconciliationDiscrepancy_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ReconciliationReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PromoCodeRedemption" DROP CONSTRAINT IF EXISTS "PromoCodeRedemption_promoCodeId_fkey";
ALTER TABLE "PromoCodeRedemption" ADD CONSTRAINT "PromoCodeRedemption_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
