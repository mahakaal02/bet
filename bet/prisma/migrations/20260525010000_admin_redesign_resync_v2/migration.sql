-- PR-BET-HOTFIX-2 — second-pass schema resync.
--
-- The first repair (20260525000000_admin_redesign_repair) used a
-- multi-line `DO $repair$ ... END $repair$;` block to gate the
-- CREATE TYPE behind an existence check. Prisma's `migrate deploy`
-- parser has known issues with multi-line PL/pgSQL blocks across
-- versions — the block can be mis-split or skipped, leaving the
-- enum uncreated.
--
-- This migration uses single-line DO blocks (parser-safe) and
-- standard `IF NOT EXISTS` guards everywhere else.

-- Enum (parser-safe single-line DO block, standard Prisma pattern
-- for idempotent enum creation).
DO $$ BEGIN CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'ADMIN'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Column.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adminRole" "AdminRole";

-- Backfill.
UPDATE "User" SET "adminRole" = 'ADMIN' WHERE "isAdmin" = TRUE AND "adminRole" IS NULL;

-- Singleton index.
CREATE UNIQUE INDEX IF NOT EXISTS "User_super_admin_singleton"
    ON "User" ("adminRole") WHERE "adminRole" = 'SUPER_ADMIN';

-- Six tables, all idempotent.
CREATE TABLE IF NOT EXISTS "AdminInvite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'ADMIN',
    "token" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(6),
    "acceptedById" TEXT,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AdminInvite_token_key" ON "AdminInvite"("token");
CREATE INDEX IF NOT EXISTS "AdminInvite_email_idx" ON "AdminInvite"("email");
CREATE INDEX IF NOT EXISTS "AdminInvite_invitedById_idx" ON "AdminInvite"("invitedById");

CREATE TABLE IF NOT EXISTS "AdminSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sensitive" BOOLEAN NOT NULL DEFAULT FALSE,
    "description" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminSetting_pkey" PRIMARY KEY ("key")
);
CREATE INDEX IF NOT EXISTS "AdminSetting_category_idx" ON "AdminSetting"("category");

CREATE TABLE IF NOT EXISTS "FraudSignal" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "userId" TEXT,
    "marketId" TEXT,
    "summary" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FraudSignal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FraudSignal_status_createdAt_idx" ON "FraudSignal"("status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "FraudSignal_userId_idx" ON "FraudSignal"("userId");
CREATE INDEX IF NOT EXISTS "FraudSignal_marketId_idx" ON "FraudSignal"("marketId");

CREATE TABLE IF NOT EXISTS "KycSubmission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documents" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectionCode" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMPTZ(6),
    "notes" TEXT,
    "faceMatchScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KycSubmission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "KycSubmission_userId_key" ON "KycSubmission"("userId");
CREATE INDEX IF NOT EXISTS "KycSubmission_status_createdAt_idx" ON "KycSubmission"("status", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "Settlement" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "totalPayout" INTEGER NOT NULL,
    "totalFees" INTEGER NOT NULL,
    "winnerCount" INTEGER NOT NULL,
    "loserCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EXECUTED',
    "executedById" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Settlement_marketId_key" ON "Settlement"("marketId");
CREATE INDEX IF NOT EXISTS "Settlement_status_createdAt_idx" ON "Settlement"("status", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "ApiLog" (
    "id" BIGSERIAL NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "userId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ApiLog_createdAt_idx" ON "ApiLog"("createdAt" DESC);
CREATE INDEX IF NOT EXISTS "ApiLog_status_createdAt_idx" ON "ApiLog"("status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "ApiLog_path_createdAt_idx" ON "ApiLog"("path", "createdAt" DESC);
