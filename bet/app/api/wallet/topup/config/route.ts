import { NextResponse } from "next/server";
import { isConfigured as cryptoConfigured } from "@/lib/nowpayments";
import { db } from "@/lib/db";

/**
 * GET /api/wallet/topup/config
 *
 * Single source of truth for which top-up paths the wallet UI should
 * surface. Pure read — never reveals secrets. Returns:
 *
 *   instantTopupEnabled — dev convenience (ALLOW_INSTANT_TOPUP=true).
 *   cryptoConfigured    — true when NOWPAYMENTS_API_KEY set. Lights
 *                         up the "Pay with crypto" CTA. The only live
 *                         payment path after the Razorpay removal.
 *   chatAppDownloadUrl  — super-admin-controlled fallback link
 *                         (PR-BET-ADMIN-FOLLOWUPS). Shown only when
 *                         NO payment path is configured.
 */
export async function GET() {
  let chatAppDownloadUrl = "";
  try {
    const row = await db.adminSetting.findUnique({
      where: { key: "wallet.chat_app_download_url" },
    });
    if (row?.value != null) {
      chatAppDownloadUrl =
        typeof row.value === "string"
          ? row.value
          : String(row.value).replace(/^"|"$/g, "");
    }
  } catch {
    /* DB blip — leave URL empty */
  }
  return NextResponse.json({
    instantTopupEnabled: process.env.ALLOW_INSTANT_TOPUP === "true",
    cryptoConfigured: cryptoConfigured(),
    chatAppDownloadUrl,
  });
}
