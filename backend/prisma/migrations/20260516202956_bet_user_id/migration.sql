-- Identity bridge for the unified wallet. `betUserId` is populated lazily by
-- BetWalletClient.ensureUser() on the first wallet operation per user.
ALTER TABLE "User" ADD COLUMN "betUserId" TEXT;
CREATE UNIQUE INDEX "User_betUserId_key" ON "User"("betUserId");
