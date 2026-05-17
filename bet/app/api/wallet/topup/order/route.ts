import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { findPack } from "@/lib/coin-packs";
import { COIN_RATE_INR, MIN_TOPUP_COINS } from "@/lib/coins";
import { createOrder, isConfigured, publicKeyId } from "@/lib/razorpay";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const Body = z.object({
  packId: z.string().min(1).max(40),
});

/**
 * Create a Razorpay order for a coin-pack purchase. Returns the order id
 * + the public key so the client can open Checkout.
 *
 * Trust boundary: the client only sends `packId`. The server looks up the
 * canonical coins + price from `lib/coin-packs.ts` — never trusts a
 * client-supplied amount. The PaymentOrder row is the audit trail.
 */
export async function POST(req: Request) {
  const u = await getAuthedUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!isConfigured()) {
    return NextResponse.json(
      { error: "razorpay_not_configured" },
      { status: 503 },
    );
  }

  const limit = rateLimit(`topup-order:${u.id}`, { limit: 10, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const pack = findPack(parsed.data.packId);
  if (!pack) {
    return NextResponse.json({ error: "unknown_pack" }, { status: 400 });
  }
  // Defense against a mis-configured pack catalog.
  if (pack.coins < MIN_TOPUP_COINS) {
    return NextResponse.json({ error: "below_min_topup" }, { status: 400 });
  }
  if (pack.priceInr !== pack.coins * COIN_RATE_INR) {
    return NextResponse.json({ error: "invalid_pack" }, { status: 500 });
  }

  try {
    const amountInPaise = pack.priceInr * 100;
    const receipt = `bet-${u.id.slice(0, 12)}-${Date.now()}`;
    const order = await createOrder(amountInPaise, receipt);

    await db.paymentOrder.create({
      data: {
        userId: u.id,
        packId: pack.id,
        amountInr: pack.priceInr,
        coins: pack.coins,
        razorpayOrderId: order.id,
        status: "PENDING",
      },
    });

    return NextResponse.json({
      ok: true,
      orderId: order.id,
      amountInr: pack.priceInr,
      amountInPaise,
      coins: pack.coins,
      packId: pack.id,
      currency: order.currency,
      razorpayKeyId: publicKeyId(),
    });
  } catch (e) {
    logger.error(e, {
      route: "/api/wallet/topup/order",
      userId: u.id,
      packId: pack.id,
    });
    return NextResponse.json({ error: "order_create_failed" }, { status: 502 });
  }
}
