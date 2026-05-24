-- PR-BET-ADMIN-REDESIGN — additive admin-feature schema.
--
-- Six new tables + an enum + a nullable column on User. Every change
-- is additive: no existing column is dropped, no constraint is added
-- that could fail on existing rows. The migration is safe to run on
-- a populated production database — it doesn't lock the User table
-- for more than the `ALTER TABLE ... ADD COLUMN` instant operation.

-- 1. Admin role enum.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AdminRole') THEN
        CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'ADMIN');
    END IF;
END$$;

-- 2. Nullable `adminRole` column on User.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adminRole" "AdminRole";

-- 3. Backfill existing isAdmin=true rows as ADMIN. Super admin
-- promotion is a separate seed step (see prisma/seed.ts) — that path
-- runs AFTER this migration commits, so the backfill is safe.
UPDATE "User" SET "adminRole" = 'ADMIN' WHERE "isAdmin" = TRUE AND "adminRole" IS NULL;

-- 4. Partial-unique index to enforce the SUPER_ADMIN-is-singleton
-- invariant at the DB layer. Multiple ADMIN rows are fine; only one
-- SUPER_ADMIN row is allowed at any time. The application layer
-- enforces this too (defence in depth).
CREATE UNIQUE INDEX IF NOT EXISTS "User_super_admin_singleton"
    ON "User" ("adminRole")
    WHERE "adminRole" = 'SUPER_ADMIN';

-- 5. AdminInvite table.
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

-- 6. AdminSetting (key-value config).
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

-- 7. FraudSignal.
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
CREATE INDEX IF NOT EXISTS "FraudSignal_status_createdAt_idx"
    ON "FraudSignal"("status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "FraudSignal_userId_idx" ON "FraudSignal"("userId");
CREATE INDEX IF NOT EXISTS "FraudSignal_marketId_idx" ON "FraudSignal"("marketId");

-- 8. KycSubmission.
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
CREATE INDEX IF NOT EXISTS "KycSubmission_status_createdAt_idx"
    ON "KycSubmission"("status", "createdAt" DESC);

-- 9. Settlement.
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
CREATE INDEX IF NOT EXISTS "Settlement_status_createdAt_idx"
    ON "Settlement"("status", "createdAt" DESC);

-- 10. ApiLog. BigInt PK because volume is high; rows accumulate fast
-- (a few-hundred/s on busy clusters). 30d retention worker keeps the
-- table size bounded; the cleanup ships in a follow-up.
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
