-- Snapshot of the bidding-engine classification at placement time.
-- Nullable; PRESENT status is always recomputed live.
ALTER TABLE "Bid" ADD COLUMN "placedStatus" TEXT;
