-- PR-TELEGRAM-LOGIN
--
-- Adds the Telegram identity columns to "User" and relaxes the
-- passwordHash NOT-NULL constraint so OAuth-only Telegram users
-- can exist without a password (the bcrypt hash is meaningless
-- when sign-in comes through the Telegram widget — we never need
-- to call `bcrypt.compare` on those accounts).
--
-- The migration is idempotent-safe because every change is either
-- ADD COLUMN (no-op if column exists; Postgres errors but Prisma
-- doesn't re-run committed migrations) or DROP NOT NULL (no-op if
-- already nullable).

-- 1. passwordHash → nullable
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- 2. Telegram identity columns
ALTER TABLE "User"
  ADD COLUMN     "telegramId"        BIGINT,
  ADD COLUMN     "telegramUsername"  TEXT,
  ADD COLUMN     "telegramFirstName" TEXT,
  ADD COLUMN     "telegramLastName"  TEXT,
  ADD COLUMN     "telegramPhotoUrl"  TEXT,
  ADD COLUMN     "telegramAuthDate"  TIMESTAMP(3);

-- 3. Unique index on telegramId so the upsert race is resolved by
-- the DB rather than by application-level locking. Only constrained
-- on NOT NULL values (Postgres treats NULLs as distinct already, so
-- this is implicit, but spelled out for the next reader).
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");
