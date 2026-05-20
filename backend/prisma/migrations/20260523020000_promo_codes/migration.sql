-- PR-CAMPAIGN-1: promo codes for coin-pack purchases.

CREATE TYPE "PromoCodeDiscountType" AS ENUM ('PERCENT', 'FLAT');

CREATE TABLE "PromoCode" (
  "id"             text                    PRIMARY KEY,
  "code"           text                    NOT NULL UNIQUE,
  "discountType"   "PromoCodeDiscountType" NOT NULL,
  "discountValue"  integer                 NOT NULL,
  "maxUses"        integer,
  "maxUsesPerUser" integer                 NOT NULL DEFAULT 1,
  "expiresAt"      timestamp(3),
  "coinPackIds"    text[]                  NOT NULL DEFAULT '{}',
  "enabled"        boolean                 NOT NULL DEFAULT true,
  "createdBy"      text                    NOT NULL,
  "notes"          text,
  "createdAt"      timestamp(3)            NOT NULL DEFAULT NOW(),
  "updatedAt"      timestamp(3)            NOT NULL DEFAULT NOW()
);
CREATE INDEX "PromoCode_enabled_expiresAt_idx" ON "PromoCode" ("enabled", "expiresAt");

CREATE TABLE "PromoCodeRedemption" (
  "id"             text         PRIMARY KEY,
  "promoCodeId"    text         NOT NULL REFERENCES "PromoCode"("id") ON DELETE CASCADE,
  "userId"         text         NOT NULL,
  "paymentOrderId" text,
  "discountInr"    integer      NOT NULL,
  "createdAt"      timestamp(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX "PromoCodeRedemption_userId_promoCodeId_idx"
  ON "PromoCodeRedemption" ("userId", "promoCodeId");
CREATE INDEX "PromoCodeRedemption_promoCodeId_createdAt_idx"
  ON "PromoCodeRedemption" ("promoCodeId", "createdAt");
