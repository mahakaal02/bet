-- PR-ORDER-1: enable the Auction ↔ Order FK.
--
-- The Foundation PR defined Order.auctionId + a unique index on it,
-- but stopped short of declaring the @relation in Prisma — leaving
-- the FK constraint un-created at the DB layer. ORDER-1 now consumes
-- the relation, so we lock down referential integrity here.
--
-- Postgres does not support `ADD CONSTRAINT IF NOT EXISTS`, so we wrap
-- the ALTER in a PL/pgSQL block and swallow `duplicate_object` to stay
-- idempotent on environments where an earlier hand-rolled migration
-- already created the constraint.

DO $$ BEGIN
  ALTER TABLE "Order"
    ADD CONSTRAINT "Order_auctionId_fkey"
    FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
