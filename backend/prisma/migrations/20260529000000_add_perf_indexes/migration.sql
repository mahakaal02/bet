-- PERF-INDEXES — two indexes that back hot, previously-unindexed scans.
--
--   1. Bid(userId, createdAt): the responsible-gambling daily-wager
--      check runs on EVERY bid placement
--        SELECT ... FROM "Bid" WHERE "userId" = $1 AND "createdAt" >= $2
--      and had no supporting index (the existing Bid indexes lead with
--      auctionId). Also serves fraud velocity, account export and the
--      cohort-retention analytics scan.
--
--   2. AviatorRound(crashedAt): aviator analytics scans crashed rounds by
--        WHERE "status" = 'CRASHED' AND "crashedAt" >= $1
--      crashedAt is the selective predicate here (status='CRASHED' is the
--      majority of historical rounds), so a dedicated crashedAt index is
--      the right shape.
--
-- IF NOT EXISTS keeps the migration a no-op on a cluster already synced
-- via `db push`, matching the idempotent style of the preceding
-- reconcile-history migration. Index names follow Prisma's default
-- `{Table}_{cols}_idx` convention so the datamodel and DB agree.

CREATE INDEX IF NOT EXISTS "Bid_userId_createdAt_idx" ON "Bid"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "AviatorRound_crashedAt_idx" ON "AviatorRound"("crashedAt");
