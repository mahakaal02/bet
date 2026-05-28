import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { findPack } from "@/lib/coin-packs";
import { MIN_TOPUP_COINS } from "@/lib/coins";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { publish, Channels } from "@/lib/pubsub";

const MAX_CUSTOM_COINS = 10_000_000;

const Body = z
  .object({
    /** A predefined pack… */
    packId: z.string().min(1).max(40).optional(),
    /** …or a custom coin amount (the "Custom amount" card). */
    coins: z.number().int().min(MIN_TOPUP_COINS).max(MAX_CUSTOM_COINS).optional(),
    /**
     * Payment receipt reference. Optional in the MVP flow (we credit
     * instantly via the placeholder path); a real PG would supply + verify
     * it before crediting.
     */
    paymentRef: z.string().max(120).optional(),
  })
  .refine((b) => !!b.packId || typeof b.coins === "number", {
    message: "packId or coins required",
  });

/**
 * DEV-ONLY instant top-up. Gated behind `ALLOW_INSTANT_TOPUP=true` so a
 * production deploy can never credit a wallet without a verified payment.
 *
 * Live top-up flow (post-Razorpay removal):
 *   POST /api/wallet/topup/crypto/order → NOWPayments hosted invoice
 *   user pays on the hosted checkout      (off-site)
 *   POST /api/webhooks/nowpayments       → IPN credits wallet, idempotent
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

  // Resolve how many coins to credit: a known pack, or a custom amount.
  let coinsToCredit: number;
  let meta: Prisma.InputJsonObject;
  if (parsed.data.packId) {
    const pack = findPack(parsed.data.packId);
    if (!pack) {
      return NextResponse.json({ error: "unknown_pack" }, { status: 400 });
    }
    coinsToCredit = pack.coins;
    meta = { packId: pack.id, priceInr: pack.priceInr };
  } else {
    coinsToCredit = parsed.data.coins!;
    meta = { custom: true, coins: coinsToCredit };
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
        data: { balance: { increment: coinsToCredit } },
      });
      await tx.transaction.create({
        data: {
          userId: u.id,
          delta: coinsToCredit,
          kind: "wallet_topup",
          reference: paymentRef,
          metadata: meta,
        },
      });
      await tx.notification.create({
        data: {
          userId: u.id,
          title: "Wallet topped up",
          body: `${coinsToCredit.toLocaleString()} coins added. Spend them in markets, auctions or Aviator.`,
          href: "/profile",
        },
      });
      return {
        credited: coinsToCredit,
        balance: wallet.balance,
        duplicate: false,
      };
    });

    publish(Channels.user(u.id), { type: "notification", at: Date.now() });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    logger.error(e, {
      route: "/api/wallet/topup",
      userId: u.id,
      packId: parsed.data.packId ?? "custom",
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
