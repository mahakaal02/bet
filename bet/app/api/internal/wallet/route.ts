import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { checkInternalSecret } from "@/lib/internal-auth";
import { logger } from "@/lib/logger";
import { publish, Channels } from "@/lib/pubsub";

/**
 * Server-to-server wallet ops. Used by:
 *
 *   - Auctions backend (NestJS): debits coins when a user bids, credits
 *     the winning bidder on close, refunds losing bidders if a market is
 *     cancelled.
 *   - Aviator service: debits round-start stake, credits cash-outs.
 *
 * Both verbs (debit / credit) share this endpoint via the `op` field so
 * adding new ones (e.g. `reserve` for a hold/release flow) is a single
 * dispatch table entry.
 *
 *   POST /api/internal/wallet
 *   Authorization: Bearer <INTERNAL_API_SECRET>
 *
 *   { op:"debit",  userId, amount, kind, reference, metadata? }
 *   { op:"credit", userId, amount, kind, reference, metadata? }
 *
 * Idempotent on (kind, reference) via the unique index on Transaction.
 * Replays return `{ ok:true, duplicate:true }` with the current balance
 * unchanged — callers can retry freely.
 *
 *   { op:"balance", userId }    → just read the current balance
 */
const Body = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("debit"),
    userId: z.string().min(1),
    amount: z.number().int().min(1).max(10_000_000),
    kind: z.string().min(1).max(60),
    reference: z.string().min(1).max(160),
    metadata: z.record(z.unknown()).optional(),
  }),
  z.object({
    op: z.literal("credit"),
    userId: z.string().min(1),
    amount: z.number().int().min(1).max(10_000_000),
    kind: z.string().min(1).max(60),
    reference: z.string().min(1).max(160),
    metadata: z.record(z.unknown()).optional(),
  }),
  z.object({
    op: z.literal("balance"),
    userId: z.string().min(1),
  }),
]);

export async function POST(req: Request) {
  const auth = checkInternalSecret(req);
  if (!auth.ok) {
    // Don't reveal whether the secret is unset vs bad — bots probing the
    // endpoint just see 401. We log the distinction internally.
    if (auth.reason === "missing_secret") {
      logger.warn(
        "/api/internal/wallet hit but INTERNAL_API_SECRET is not configured",
      );
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // Balance read — no DB writes, no atomicity concerns.
  if (parsed.data.op === "balance") {
    const wallet = await db.wallet.findUnique({
      where: { userId: parsed.data.userId },
      select: { balance: true },
    });
    if (!wallet) {
      return NextResponse.json({ error: "user_not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, balance: wallet.balance });
  }

  const { userId, amount, kind, reference, op, metadata } = parsed.data;
  const signed = op === "credit" ? amount : -amount;

  try {
    const result = await db.$transaction(async (tx) => {
      // Idempotency check — a replay with the same (kind, reference) is a
      // no-op that returns the current balance.
      const existing = await tx.transaction.findUnique({
        where: { uniq_kind_reference: { kind, reference } },
      });
      if (existing) {
        const wallet = await tx.wallet.findUnique({
          where: { userId },
          select: { balance: true },
        });
        return {
          ok: true as const,
          duplicate: true,
          balance: wallet?.balance ?? 0,
        };
      }

      // For a debit, check sufficient funds BEFORE modifying anything.
      if (op === "debit") {
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet) return { ok: false as const, error: "user_not_found", status: 404 };
        if (wallet.balance < amount) {
          return {
            ok: false as const,
            error: "insufficient_coins",
            status: 400,
            balance: wallet.balance,
          };
        }
      }

      const wallet = await tx.wallet.update({
        where: { userId },
        data: { balance: { increment: signed } },
      });
      await tx.transaction.create({
        data: {
          userId,
          delta: signed,
          kind,
          reference,
          // Cast: Prisma's Json column expects InputJsonValue; the validator
          // delivers a plain Record which is structurally compatible.
          metadata: metadata
            ? (metadata as Prisma.InputJsonValue)
            : undefined,
        },
      });
      return { ok: true as const, duplicate: false, balance: wallet.balance };
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, balance: "balance" in result ? result.balance : undefined },
        { status: result.status },
      );
    }

    // Tell the user's SSE channel so the in-app wallet UI re-fetches.
    publish(Channels.user(userId), { type: "wallet", at: Date.now() });
    return NextResponse.json({
      ok: true,
      duplicate: result.duplicate,
      balance: result.balance,
    });
  } catch (e) {
    // Foreign-key violations (no such user) become 404, everything else
    // is logged and returned as 500.
    if ((e as { code?: string })?.code === "P2025") {
      return NextResponse.json({ error: "user_not_found" }, { status: 404 });
    }
    logger.error(e, {
      route: "/api/internal/wallet",
      op,
      userId,
      kind,
      reference,
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
