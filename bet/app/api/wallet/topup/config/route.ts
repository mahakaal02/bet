import { NextResponse } from "next/server";
import { isConfigured, publicKeyId } from "@/lib/razorpay";

/**
 * Tells the client which top-up path is available. Returned to BuyCoinsGrid
 * so it can render the right "Buy" button (Razorpay Checkout vs the
 * dev-only instant credit). Never reveals secrets — only the public
 * Razorpay key id, which is intended to be in the page anyway.
 */
export async function GET() {
  return NextResponse.json({
    razorpayConfigured: isConfigured(),
    razorpayKeyId: publicKeyId(),
    instantTopupEnabled: process.env.ALLOW_INSTANT_TOPUP === "true",
  });
}
