-- PR-BET-NOWPAYMENTS — CryptoPaymentOrder table for the NOWPayments
-- top-up flow. Additive — no existing column dropped, no constraint
-- added that could fail on existing rows.

CREATE TABLE IF NOT EXISTS "CryptoPaymentOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "amountInr" INTEGER NOT NULL,
    "coins" INTEGER NOT NULL,
    "invoiceId" TEXT,
    "paymentId" TEXT,
    "payCurrency" TEXT,
    "payAmount" TEXT,
    "payAddress" TEXT,
    "hostedInvoiceUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rawWebhook" JSONB,
    "failureReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedAt" TIMESTAMPTZ(6),
    CONSTRAINT "CryptoPaymentOrder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CryptoPaymentOrder_invoiceId_key" ON "CryptoPaymentOrder"("invoiceId");
CREATE UNIQUE INDEX IF NOT EXISTS "CryptoPaymentOrder_paymentId_key" ON "CryptoPaymentOrder"("paymentId");
CREATE INDEX IF NOT EXISTS "CryptoPaymentOrder_userId_createdAt_idx" ON "CryptoPaymentOrder"("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "CryptoPaymentOrder_status_createdAt_idx" ON "CryptoPaymentOrder"("status", "createdAt" DESC);

ALTER TABLE "CryptoPaymentOrder"
  ADD CONSTRAINT "CryptoPaymentOrder_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
