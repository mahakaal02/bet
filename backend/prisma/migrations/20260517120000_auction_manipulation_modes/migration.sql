-- Admin manipulation modes on Auction. NORMAL is the natural game; the
-- two non-normal modes let the admin either pre-pick the winner (FIXED_WINNER
-- + fixedWinningAmount) or guarantee no one wins (NO_WINNER, in which the
-- ringmaster sentinel auto-collides every winning bid).

CREATE TYPE "AuctionManipulationMode" AS ENUM ('NORMAL', 'NO_WINNER', 'FIXED_WINNER');

ALTER TABLE "Auction"
  ADD COLUMN "manipulationMode"   "AuctionManipulationMode" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "fixedWinningAmount" DECIMAL(12,2);
