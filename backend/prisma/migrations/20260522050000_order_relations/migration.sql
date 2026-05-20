-- PR-ORDER-1: enable the Auction ↔ Order FK.
--
-- The Foundation PR defined Order.auctionId + a unique index on it,
-- but stopped short of declaring the @relation in Prisma — leaving
-- the FK constraint un-created at the DB layer. ORDER-1 now consumes
-- the relation, so we lock down referential integrity here.
--
-- IF NOT EXISTS guards make this safe on any environment where some
-- earlier hand-rolled migration already added the constraint.

ALTER TABLE "Order"
  ADD CONSTRAINT IF NOT EXISTS "Order_auctionId_fkey"
  FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE;
