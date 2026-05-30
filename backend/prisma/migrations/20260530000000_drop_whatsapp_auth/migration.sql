-- Remove WhatsApp OTP authentication (the auth-whatsapp module was deleted).
-- Drops the WhatsApp-only identity column and the OTP table. The
-- column's UNIQUE index is dropped implicitly with the column.
-- NOTE: "User"."phoneVerified" is intentionally RETAINED — it backs the
-- signup-funnel analytics (analytics.service.ts) and may be reused for a
-- future SMS/Telegram phone-verification flow.
DROP TABLE IF EXISTS "PhoneOtp";
ALTER TABLE "User" DROP COLUMN IF EXISTS "whatsappPhone";
