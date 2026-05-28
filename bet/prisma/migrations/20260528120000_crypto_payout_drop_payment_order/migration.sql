-- PR-FIX-MIGRATIONS — backfills the migration PR #116 omitted (bet).
--
-- PR #116 added PayoutMethod.CRYPTO and removed the (Razorpay-only)
-- PaymentOrder model + PaymentOrderStatus enum from
-- bet/prisma/schema.prisma without shipping a migration directory. In
-- the cluster the DB therefore still lacks the CRYPTO payout value, so
-- crypto withdrawals fail ("invalid input value for enum PayoutMethod:
-- CRYPTO"). This file is that missing delta, guarded so it's safe on
-- both the pre-#116 schema (the cluster) and an already
-- `db push`-synced DB (a developer box).

-- New payout rail for withdrawals (UPI | BANK | CRYPTO). ADD VALUE is
-- transaction-safe on PostgreSQL 12+ because the new label is not
-- referenced inside this migration.
ALTER TYPE "PayoutMethod" ADD VALUE IF NOT EXISTS 'CRYPTO';

-- Razorpay's order table + status enum are gone — NOWPayments crypto is
-- the only payment path now, and crypto top-ups use CryptoPaymentOrder.
ALTER TABLE IF EXISTS "PaymentOrder" DROP CONSTRAINT IF EXISTS "PaymentOrder_userId_fkey";
DROP TABLE IF EXISTS "PaymentOrder";
DROP TYPE IF EXISTS "PaymentOrderStatus";
