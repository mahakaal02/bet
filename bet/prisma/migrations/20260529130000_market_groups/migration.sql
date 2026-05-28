-- Grouped markets (Kalshi-style events). PURELY ADDITIVE:
--   • two new enums + a new "MarketGroup" table
--   • two nullable columns on "Market" (groupId, groupSortOrder) + index + FK
-- Existing markets get groupId = NULL and behave exactly as before. No
-- destructive operations (no DROP, no ALTER COLUMN ... NOT NULL, no type change).

CREATE TYPE "MarketGroupType" AS ENUM ('EXCLUSIVE', 'INDEPENDENT');
CREATE TYPE "MarketGroupStatus" AS ENUM ('OPEN', 'CLOSED', 'RESOLVED', 'CANCELLED');

CREATE TABLE "MarketGroup" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "MarketCategory" NOT NULL,
    "type" "MarketGroupType" NOT NULL DEFAULT 'EXCLUSIVE',
    "status" "MarketGroupStatus" NOT NULL DEFAULT 'OPEN',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "resolvedWinnerMarketId" TEXT,
    "resolvedAt" TIMESTAMPTZ(6),
    "resolutionNote" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "MarketGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketGroup_slug_key" ON "MarketGroup"("slug");
CREATE INDEX "MarketGroup_status_sortOrder_idx" ON "MarketGroup"("status", "sortOrder");
CREATE INDEX "MarketGroup_category_status_idx" ON "MarketGroup"("category", "status");
CREATE INDEX "MarketGroup_featured_idx" ON "MarketGroup"("featured");

-- Additive nullable columns on Market. NOT NULL is intentionally avoided so
-- existing rows remain valid with no backfill.
ALTER TABLE "Market" ADD COLUMN "groupId" TEXT;
ALTER TABLE "Market" ADD COLUMN "groupSortOrder" INTEGER;

CREATE INDEX "Market_groupId_idx" ON "Market"("groupId");

-- SET NULL (not CASCADE): deleting a group orphans its children back to
-- standalone markets — it must never delete markets that hold positions/coins.
ALTER TABLE "Market"
  ADD CONSTRAINT "Market_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "MarketGroup"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
