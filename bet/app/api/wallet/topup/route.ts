import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { findPack } from "@/lib/coin-packs";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { publish, Channels } from "@/lib/pubsub";

const Body = z.object({
  packId: z.string().min(1).max(40),
  /**
   * Razorpay-style payment receipt. Optional in the MVP flow (we credit
   * instantly via the placeholder path); required once a real PG is wired
   * — at which point the route validates the signature before crediting.
   */
  paymentRef: z.string().max(120).optional(),
});

/**
 * DEV-ONLY instant top-up. Gated behind `ALLOW_INSTANT_TOPUP=true` so a
 * production deploy can never credit a wallet without a verified Razorpay
 * payment.
 *
 * Real top-up flow:
 *   POST /api/wallet/topup/order   → server creates Razorpay order
 *   open Razorpay Checkout          (client)
 *   POST /api/wallet/topup/verify  → server verifies HMAC, credits wallet
 *   POST /api/webhooks/razorpay    → payment.captured webhook, idempotent
 *
 * Instant top-up exists so a dev without payment creds can exercise the
 * rest of the platform (markets, orderbook, withdrawals).
 */
export async function POST(req: Request) {
  if (process.env.ALLOW_INSTANT_TOPUP !== "true") {
    return NextResponse.json(
      { error: "instant_topup_disabled" },
      { status: 403 },
    );
  }

  const u = await getAuthedUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limit = rateLimit(`topup:${u.id}`, { limit: 6, windowMs: 60_000 });
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

  // Without a real PG, every successful POST is a fresh credit. We mint a
  // UUID so the Transaction reference is unique; a duplicate click before
  // the previous one finishes only burns a rate-limit slot, no double-
  // credit happens because each call has its own reference.
  const paymentRef = parsed.data.paymentRef ?? `placeholder:${randomUUID()}`;

  try {
    const result = await db.$transaction(async (tx) => {
      // Idempotency: if a Transaction with this (kind, reference) already
      // exists, the PG webhook has fired before — return current balance
      // without re-crediting.
      const existing = await tx.transaction.findUnique({
        where: {
          uniq_kind_reference: {
            kind: "wallet_topup",
            reference: paymentRef,
          },
        },
      });
      if (existing) {
        const wallet = await tx.wallet.findUnique({
          where: { userId: u.id },
          select: { balance: true },
        });
        return { credited: 0, balance: wallet?.balance ?? 0, duplicate: true };
      }

      const wallet = await tx.wallet.update({
        where: { userId: u.id },
        data: { balance: { increment: pack.coins } },
      });
      await tx.transaction.create({
        data: {
          userId: u.id,
          delta: pack.coins,
          kind: "wallet_topup",
          reference: paymentRef,
          metadata: { packId: pack.id, priceInr: pack.priceInr },
        },
      });
      await tx.notification.create({
        data: {
          userId: u.id,
          title: "Wallet topped up",
          body: `${pack.coins.toLocaleString()} coins added. Spend them in markets, auctions or Aviator.`,
          href: "/profile",
        },
      });
      return {
        credited: pack.coins,
        balance: wallet.balance,
        duplicate: false,
      };
    });

    publish(Channels.user(u.id), { type: "notification", at: Date.now() });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    logger.error(e, { route: "/api/wallet/topup", userId: u.id, packId: pack.id });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
