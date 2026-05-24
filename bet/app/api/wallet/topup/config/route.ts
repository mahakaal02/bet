import { NextResponse } from "next/server";
import { isConfigured, publicKeyId } from "@/lib/razorpay";
import { db } from "@/lib/db";

/**
 * Tells the client which top-up path is available. Returned to BuyCoinsGrid
 * so it can render the right "Buy" button.
 *
 * PR-BET-ADMIN-FOLLOWUPS — also returns the super-admin-controlled
 * `chatAppDownloadUrl`. When Razorpay isn't configured and instant-topup
 * is off, the client renders a "Download Secured Chat App now" link
 * pointing at this URL instead of the old developer-leaning copy. Empty
 * string means no link is shown.
 *
 * Never reveals secrets — only the public Razorpay key id (which is
 * intended to be in the page anyway) and the chat-app URL (which is
 * public by design — it's a download link to share with users).
 */
export async function GET() {
  let chatAppDownloadUrl = "";
  try {
    const row = await db.adminSetting.findUnique({
      where: { key: "wallet.chat_app_download_url" },
    });
    if (row?.value != null) {
      // Setting is stored as a JSON value; if it's already a string
      // use it verbatim, otherwise coerce + strip the JSON quotes.
      chatAppDownloadUrl =
        typeof row.value === "string"
          ? row.value
          : String(row.value).replace(/^"|"$/g, "");
    }
  } catch {
    /* DB blip — leave URL empty, page degrades gracefully */
  }
  return NextResponse.json({
    razorpayConfigured: isConfigured(),
    razorpayKeyId: publicKeyId(),
    instantTopupEnabled: process.env.ALLOW_INSTANT_TOPUP === "true",
    chatAppDownloadUrl,
  });
}
