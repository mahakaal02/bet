-- PR-FIX-MIGRATIONS — backfills the migration PR #116 omitted (backend).
--
-- PR #116 edited backend/prisma/schema.prisma (PPP regional-pricing
-- tables, CoinPack.baseUsdPrice + sku, priceInr → nullable, dropped the
-- Razorpay PaymentOrder columns, removed OutboxKind.RAZORPAY_REFUND) but
-- shipped NO migration directory. In the cluster the prisma-migrate init
-- container's `migrate deploy` therefore had nothing to apply, the DB
-- kept the pre-#116 schema, and the prisma-seed init container then died
-- writing CoinPack.baseUsdPrice ("column does not exist") — which blocks
-- the backend pod from starting. This file is that missing delta.
--
-- Every statement is guarded (IF [NOT] EXISTS / existence DO-blocks) so
-- it applies cleanly whether the target DB is on the pre-#116 schema
-- (the cluster) or was already `db push`-synced (a developer box).

-- ── CoinPack: USD anchor + store SKU; legacy INR price now optional ──
ALTER TABLE "CoinPack" ADD COLUMN IF NOT EXISTS "baseUsdPrice" DECIMAL(10,2);
ALTER TABLE "CoinPack" ADD COLUMN IF NOT EXISTS "sku" TEXT;
ALTER TABLE "CoinPack" ALTER COLUMN "priceInr" DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "CoinPack_sku_key" ON "CoinPack"("sku");

-- ── PaymentOrder: drop the Razorpay-specific columns ──
DROP INDEX IF EXISTS "PaymentOrder_razorpayOrderId_key";
ALTER TABLE "PaymentOrder" DROP COLUMN IF EXISTS "razorpayOrderId";
ALTER TABLE "PaymentOrder" DROP COLUMN IF EXISTS "razorpayPaymentId";

-- ── OutboxKind: drop the RAZORPAY_REFUND value. Postgres has no
--    "DROP VALUE", so the type is recreated. Guarded on the value still
--    being present (no-op once applied); any stale queue rows of that
--    kind are purged first so the column-type swap's USING cast can't
--    fail. ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'OutboxKind' AND e.enumlabel = 'RAZORPAY_REFUND'
  ) THEN
    DELETE FROM "Outbox" WHERE "kind" = 'RAZORPAY_REFUND';
    CREATE TYPE "OutboxKind_new" AS ENUM ('BET_WALLET_DEBIT', 'BET_WALLET_CREDIT', 'FCM_PUSH', 'SES_EMAIL', 'ADMIN_AUDIT_REPLAY');
    ALTER TABLE "Outbox" ALTER COLUMN "kind" TYPE "OutboxKind_new" USING ("kind"::text::"OutboxKind_new");
    ALTER TYPE "OutboxKind" RENAME TO "OutboxKind_old";
    ALTER TYPE "OutboxKind_new" RENAME TO "OutboxKind";
    DROP TYPE "OutboxKind_old";
  END IF;
END $$;

-- ── PPP (Purchasing Power Parity) regional-pricing tables. See
--    backend/PRICING.md. ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PricingSnapshotStatus') THEN
    CREATE TYPE "PricingSnapshotStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED', 'FAILED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "PricingSnapshot" (
    "id" TEXT NOT NULL,
    "effectiveYear" INTEGER NOT NULL,
    "status" "PricingSnapshotStatus" NOT NULL DEFAULT 'DRAFT',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "baselineCountry" TEXT NOT NULL DEFAULT 'US',
    "forexSource" TEXT NOT NULL,
    "pppSource" TEXT NOT NULL,
    "generatedBy" TEXT,
    "notes" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ForexRateSnapshot" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "effectiveYear" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "usdRate" DECIMAL(18,6) NOT NULL,
    "source" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForexRateSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PppFactorSnapshot" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "effectiveYear" INTEGER NOT NULL,
    "countryCode" TEXT NOT NULL,
    "rawPppValue" DECIMAL(18,6),
    "normalizedMultiplier" DECIMAL(8,4) NOT NULL,
    "source" TEXT NOT NULL,
    "isFallback" BOOLEAN NOT NULL DEFAULT false,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PppFactorSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RegionalCoinPricing" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "coinPackId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "baseUsdPrice" DECIMAL(10,2) NOT NULL,
    "forexRate" DECIMAL(18,6) NOT NULL,
    "pppMultiplier" DECIMAL(8,4) NOT NULL,
    "calculatedLocalPrice" DECIMAL(14,4) NOT NULL,
    "roundedFinalPrice" DECIMAL(14,2) NOT NULL,
    "effectiveYear" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceExchangeRate" TEXT NOT NULL,
    "sourcePppData" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RegionalCoinPricing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PricingSnapshot_effectiveYear_key" ON "PricingSnapshot"("effectiveYear");
CREATE INDEX IF NOT EXISTS "PricingSnapshot_isActive_idx" ON "PricingSnapshot"("isActive");
CREATE INDEX IF NOT EXISTS "PricingSnapshot_status_idx" ON "PricingSnapshot"("status");
CREATE INDEX IF NOT EXISTS "ForexRateSnapshot_effectiveYear_idx" ON "ForexRateSnapshot"("effectiveYear");
CREATE UNIQUE INDEX IF NOT EXISTS "ForexRateSnapshot_snapshotId_currencyCode_key" ON "ForexRateSnapshot"("snapshotId", "currencyCode");
CREATE INDEX IF NOT EXISTS "PppFactorSnapshot_effectiveYear_idx" ON "PppFactorSnapshot"("effectiveYear");
CREATE UNIQUE INDEX IF NOT EXISTS "PppFactorSnapshot_snapshotId_countryCode_key" ON "PppFactorSnapshot"("snapshotId", "countryCode");
CREATE INDEX IF NOT EXISTS "RegionalCoinPricing_countryCode_isActive_idx" ON "RegionalCoinPricing"("countryCode", "isActive");
CREATE INDEX IF NOT EXISTS "RegionalCoinPricing_effectiveYear_idx" ON "RegionalCoinPricing"("effectiveYear");
CREATE UNIQUE INDEX IF NOT EXISTS "RegionalCoinPricing_snapshotId_coinPackId_countryCode_key" ON "RegionalCoinPricing"("snapshotId", "coinPackId", "countryCode");

-- ── Foreign keys. ADD CONSTRAINT has no IF NOT EXISTS, so each is
--    guarded by name. ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ForexRateSnapshot_snapshotId_fkey') THEN
    ALTER TABLE "ForexRateSnapshot" ADD CONSTRAINT "ForexRateSnapshot_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "PricingSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PppFactorSnapshot_snapshotId_fkey') THEN
    ALTER TABLE "PppFactorSnapshot" ADD CONSTRAINT "PppFactorSnapshot_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "PricingSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RegionalCoinPricing_snapshotId_fkey') THEN
    ALTER TABLE "RegionalCoinPricing" ADD CONSTRAINT "RegionalCoinPricing_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "PricingSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RegionalCoinPricing_coinPackId_fkey') THEN
    ALTER TABLE "RegionalCoinPricing" ADD CONSTRAINT "RegionalCoinPricing_coinPackId_fkey" FOREIGN KEY ("coinPackId") REFERENCES "CoinPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
