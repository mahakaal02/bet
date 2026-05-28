import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import {
  MIN_WITHDRAW_COINS,
  WITHDRAW_EMAIL_VERIFY_THRESHOLD_COINS,
} from "@/lib/coins";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const amountField = z.number().int().min(MIN_WITHDRAW_COINS).max(10_000_000);

const UpiBody = z.object({
  payoutMethod: z.literal("UPI"),
  amountCoins: amountField,
  upiId: z.string().regex(/^[\w.\-]{2,256}@[\w]{2,64}$/, "valid UPI ID"),
});

// Global bank transfer: SWIFT/BIC + account number / IBAN + bank name +
// country + beneficiary. Validations are intentionally loose (formats
// vary worldwide); the admin verifies before paying out.
const BankBody = z.object({
  payoutMethod: z.literal("BANK"),
  amountCoins: amountField,
  beneficiaryName: z.string().min(2).max(120),
  bankName: z.string().min(2).max(120),
  bankCountry: z.string().min(2).max(80),
  swiftBic: z.string().regex(/^[A-Za-z0-9]{8}([A-Za-z0-9]{3})?$/, "valid SWIFT/BIC"),
  accountIban: z.string().regex(/^[A-Za-z0-9 ]{4,40}$/, "account number / IBAN"),
});

// Crypto payout: network/asset + destination wallet address.
const CryptoBody = z.object({
  payoutMethod: z.literal("CRYPTO"),
  amountCoins: amountField,
  network: z.enum([
    "USDT-TRC20",
    "USDT-ERC20",
    "USDT-BEP20",
    "USDC-ERC20",
    "BTC",
    "ETH",
  ]),
  walletAddress: z.string().regex(/^[A-Za-z0-9:_.\-]{20,120}$/, "wallet address"),
});

const Body = z.discriminatedUnion("payoutMethod", [UpiBody, BankBody, CryptoBody]);

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
  // Email verification is only required for larger payouts. Small
  // withdrawals (≤ threshold) go through without it.
  if (
    data.amountCoins > WITHDRAW_EMAIL_VERIFY_THRESHOLD_COINS &&
    !me.emailVerified
  ) {
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
      : data.payoutMethod === "BANK"
        ? {
            beneficiaryName: data.beneficiaryName,
            bankName: data.bankName,
            bankCountry: data.bankCountry,
            swiftBic: data.swiftBic.toUpperCase(),
            accountIban: data.accountIban.replace(/\s+/g, "").toUpperCase(),
          }
        : {
            network: data.network,
            walletAddress: data.walletAddress,
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
          body: `${data.amountCoins.toLocaleString()} coins requested via ${data.payoutMethod}. We'll review and process it within 24h.`,
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
