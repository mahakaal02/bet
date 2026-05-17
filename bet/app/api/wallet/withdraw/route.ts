import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { MIN_WITHDRAW_COINS } from "@/lib/coins";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const UpiBody = z.object({
  payoutMethod: z.literal("UPI"),
  amountCoins: z.number().int().min(MIN_WITHDRAW_COINS).max(10_000_000),
  upiId: z.string().regex(/^[\w.\-]{2,256}@[\w]{2,64}$/, "valid UPI ID"),
});

const BankBody = z.object({
  payoutMethod: z.literal("BANK"),
  amountCoins: z.number().int().min(MIN_WITHDRAW_COINS).max(10_000_000),
  accountNumber: z.string().regex(/^\d{6,20}$/),
  ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/),
  beneficiaryName: z.string().min(2).max(80),
});

const Body = z.discriminatedUnion("payoutMethod", [UpiBody, BankBody]);

/**
 * Submit a withdrawal request. Atomic: locks the coins (debits the wallet,
 * writes a `kind="withdrawal_lock"` audit row) and creates a PENDING
 * WithdrawalRequest in the same transaction. Admin reviews + approves
 * before any actual payout fires.
 *
 * Email-verified accounts only — keeps spam accounts from grinding the
 * admin queue.
 *
 * Records the requesting IP + user-agent for the admin audit page. These
 * never appear in user-facing responses.
 */
export async function POST(req: Request) {
  const u = await getAuthedUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Aggressive limit — withdrawal spam is the canonical abuse vector here.
  const limit = rateLimit(`withdraw:${u.id}`, { limit: 3, windowMs: 60 * 60_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", details: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const me = await db.user.findUnique({
    where: { id: u.id },
    select: { emailVerified: true, banned: true },
  });
  if (!me || me.banned) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!me.emailVerified) {
    return NextResponse.json({ error: "email_not_verified" }, { status: 403 });
  }

  // Best-effort fingerprint for the admin audit page. x-forwarded-for is
  // what gets through Vercel / Cloudflare; req.headers.get('cf-connecting-
  // ip') would be preferred on CF but is null elsewhere.
  const ipAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;
  const userAgent = req.headers.get("user-agent") ?? null;

  const payoutDetails =
    data.payoutMethod === "UPI"
      ? { upiId: data.upiId }
      : {
          accountNumber: data.accountNumber,
          ifsc: data.ifsc,
          beneficiaryName: data.beneficiaryName,
        };

  try {
    const result = await db.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId: u.id } });
      if (!wallet) return { ok: false as const, error: "wallet_missing", status: 404 };
      if (wallet.balance < data.amountCoins) {
        return { ok: false as const, error: "insufficient_coins", status: 400 };
      }

      // Debit the wallet — the coins are LOCKED in the request. A
      // REJECTED / CANCELLED status fires a compensating credit later.
      await tx.wallet.update({
        where: { userId: u.id },
        data: { balance: { decrement: data.amountCoins } },
      });

      const withdrawal = await tx.withdrawalRequest.create({
        data: {
          userId: u.id,
          amountCoins: data.amountCoins,
          payoutMethod: data.payoutMethod,
          payoutDetails: payoutDetails as Prisma.InputJsonValue,
          ipAddress,
          userAgent,
        },
      });

      await tx.transaction.create({
        data: {
          userId: u.id,
          delta: -data.amountCoins,
          kind: "withdrawal_lock",
          reference: `withdrawal:${withdrawal.id}`,
          metadata: {
            payoutMethod: data.payoutMethod,
            withdrawalId: withdrawal.id,
          },
        },
      });

      await tx.notification.create({
        data: {
          userId: u.id,
          title: "Withdrawal submitted",
          body: `₹${data.amountCoins} requested via ${data.payoutMethod}. We'll review and process it within 24h.`,
          href: "/wallet",
        },
      });

      return { ok: true as const, id: withdrawal.id };
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }
    return NextResponse.json({ ok: true, id: result.id });
  } catch (e) {
    logger.error(e, {
      route: "/api/wallet/withdraw",
      userId: u.id,
      amount: data.amountCoins,
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

/** List the signed-in user's withdrawals. */
export async function GET() {
  const u = await getAuthedUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await db.withdrawalRequest.findMany({
    where: { userId: u.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      amountCoins: true,
      payoutMethod: true,
      status: true,
      createdAt: true,
      decidedAt: true,
      decisionNote: true,
      paidAt: true,
    },
  });
  return NextResponse.json({ items: rows });
}
