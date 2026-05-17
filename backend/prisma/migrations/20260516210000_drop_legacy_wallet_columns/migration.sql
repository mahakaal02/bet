-- Drop legacy local-balance state. Bet (Kalki Exchange) is now the sole
-- wallet authority — `User.coinBalance` + `User.walletBalance` columns and
-- the `WalletTransaction` / `WithdrawalRequest` audit tables are obsolete.
-- All callers (backend, Aviator, admin SPA) read through the Bet REST API.

-- Drop dependent FKs first (CASCADE handles index cleanup).
DROP TABLE IF EXISTS "WalletTransaction" CASCADE;
DROP TABLE IF EXISTS "WithdrawalRequest" CASCADE;
DROP TYPE  IF EXISTS "WithdrawalStatus";

ALTER TABLE "User" DROP COLUMN IF EXISTS "coinBalance";
ALTER TABLE "User" DROP COLUMN IF EXISTS "walletBalance";
