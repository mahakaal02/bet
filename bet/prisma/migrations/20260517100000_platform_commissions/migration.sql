-- Platform commission rollout.
--
-- Adds (a) per-fill fee snapshot on Trade so each row carries the rake we
-- skimmed, and (b) a singleton counter row for revenue analytics so the
-- admin dashboard reads O(1) instead of aggregating the Transaction ledger.
-- Both are additive; existing trades get `feeCoins = 0` and continue to
-- read cleanly.

ALTER TABLE "Trade" ADD COLUMN "feeCoins" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "PlatformRevenue" (
  "id"                   TEXT        NOT NULL DEFAULT 'singleton',
  "totalTradingFees"     INTEGER     NOT NULL DEFAULT 0,
  "totalSettlementFees"  INTEGER     NOT NULL DEFAULT 0,
  "totalPlatformRevenue" INTEGER     NOT NULL DEFAULT 0,
  "updatedAt"            TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PlatformRevenue_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton row so the first commission can `update` it without
-- needing an upsert in every trade path.
INSERT INTO "PlatformRevenue" ("id", "updatedAt") VALUES ('singleton', NOW())
  ON CONFLICT ("id") DO NOTHING;
