-- PR-BET-I18N — sidecar table for per-locale market translations.
--
-- Holds optional translations of Market.title and Market.description.
-- A market with no row here falls back to the canonical Market.* fields
-- (the authoring language). One row per (marketId, locale); columns are
-- nullable so a translator can fill only one field at a time.

CREATE TABLE "MarketTranslation" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "authorId" TEXT,

    CONSTRAINT "MarketTranslation_pkey" PRIMARY KEY ("id")
);

-- One row per (market, locale) — enforced for safe upserts under
-- concurrent admin edits.
CREATE UNIQUE INDEX "MarketTranslation_marketId_locale_key"
  ON "MarketTranslation"("marketId", "locale");

-- Locale-only index for "list every translated market in pt-BR" admin
-- queries.
CREATE INDEX "MarketTranslation_locale_idx" ON "MarketTranslation"("locale");

-- Cascade — orphan translations are useless and would otherwise block
-- admin Market deletion.
ALTER TABLE "MarketTranslation"
  ADD CONSTRAINT "MarketTranslation_marketId_fkey"
  FOREIGN KEY ("marketId") REFERENCES "Market"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
