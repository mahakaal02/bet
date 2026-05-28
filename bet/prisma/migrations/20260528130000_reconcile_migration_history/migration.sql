-- RECONCILE-HISTORY — realign the bet migration history with
-- bet/prisma/schema.prisma.
--
-- As on the backend, some schema changes were historically applied with
-- `prisma db push` and committed without a matching migration directory,
-- so a DB rebuilt purely from `prisma migrate deploy` drifts from the
-- datamodel. The bet drift is small: two `@updatedAt` columns were created
-- with a `DEFAULT CURRENT_TIMESTAMP` the datamodel does not declare (Prisma
-- sets updatedAt from the client, so the column carries no DB default).
--
-- This is the exact delta reported by `prisma migrate diff` between the
-- migration chain and the schema datamodel. `ALTER COLUMN ... DROP DEFAULT`
-- is inherently idempotent (a no-op when no default is present), so this
-- applies cleanly on a fresh migrate-deploy DB and re-applies as a no-op on
-- the already-synced cluster.

ALTER TABLE "KycSubmission" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Settlement" ALTER COLUMN "updatedAt" DROP DEFAULT;
