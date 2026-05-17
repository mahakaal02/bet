import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { quoteBuy, quoteSell, chargeForCoins } from "@/lib/amm";
import { rateLimit } from "@/lib/rate-limit";
import { publish, Channels } from "@/lib/pubsub";
import { onTrade, publishUnlocks } from "@/lib/achievements";
import { logger } from "@/lib/logger";
import { splitBuy, splitSell } from "@/lib/commission";
import { collectFee } from "@/lib/house";
import { InsufficientFundsError, safeDebit } from "@/lib/wallet-safe";
import type { Outcome } from "@prisma/client";

// Two-shape body — discriminated on `side`. Legacy callers that omit `side`
// are treated as BUY for backwards compatibility (the old API only knew how
// to buy).
const Body = z
  .discriminatedUnion("side", [
    z.object({
      side: z.literal("BUY"),
      marketId: z.string().min(1),
      outcome: z.enum(["YES", "NO"]),
      coins: z.number().int().min(1).max(1_000_000),
    }),
    z.object({
      side: z.literal("SELL"),
      marketId: z.string().min(1),
      outcome: z.enum(["YES", "NO"]),
      shares: z.number().gt(0).max(1_000_000),
    }),
  ])
  .or(
    z.object({
      // Legacy shape — no `side`. Mapped to BUY.
      marketId: z.string().min(1),
      outcome: z.enum(["YES", "NO"]),
      coins: z.number().int().min(1).max(1_000_000),
    }),
  );

export async function POST(req: Request) {
  const u = await getAuthedUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limit = rateLimit(`trade:${u.id}`, { limit: 10, windowMs: 10_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  // Normalise to a single shape with explicit `side` before dispatch — the
  // discriminated union + legacy shape would otherwise break narrowing.
  const data = parsed.data as
    | { side: "BUY"; marketId: string; outcome: "YES" | "NO"; coins: number }
    | { side: "SELL"; marketId: string; outcome: "YES" | "NO"; shares: number }
    | { marketId: string; outcome: "YES" | "NO"; coins: number };
  const normalised:
    | { side: "BUY"; marketId: string; outcome: "YES" | "NO"; coins: number }
    | { side: "SELL"; marketId: string; outcome: "YES" | "NO"; shares: number } =
    "side" in data
      ? data
      : { side: "BUY", marketId: data.marketId, outcome: data.outcome, coins: data.coins };

  try {
    if (normalised.side === "BUY") {
      const result = await executeBuy(
        u.id,
        normalised.marketId,
        normalised.outcome,
        normalised.coins,
      );
      publish(Channels.market(result.market.id), {
        type: "trade",
        yesPrice: result.market.yesPrice,
        noPrice: result.market.noPrice,
        volumeCoins: result.market.volumeCoins,
        side: normalised.outcome,
        action: "BUY",
        cost: result.trade.cost,
        at: Date.now(),
      });
      publish(Channels.global(), {
        type: "activity",
        marketId: result.market.id,
        marketTitle: result.market.title,
        marketSlug: result.market.slug,
        action: "BUY",
        outcome: normalised.outcome,
        username: u.username,
        coins: result.trade.cost,
        shares: result.trade.shares,
        price: result.trade.avgPrice,
        at: Date.now(),
      });
      publishUnlocks(u.id, result.unlocks);
      return NextResponse.json({ ok: true, ...result });
    } else {
      const result = await executeSell(
        u.id,
        normalised.marketId,
        normalised.outcome,
        normalised.shares,
      );
      publish(Channels.market(result.market.id), {
        type: "trade",
        yesPrice: result.market.yesPrice,
        noPrice: result.market.noPrice,
        volumeCoins: result.market.volumeCoins,
        side: normalised.outcome,
        action: "SELL",
        cost: result.trade.coinsReceived,
        at: Date.now(),
      });
      publish(Channels.global(), {
        type: "activity",
        marketId: result.market.id,
        marketTitle: result.market.title,
        marketSlug: result.market.slug,
        action: "SELL",
        outcome: normalised.outcome,
        username: u.username,
        coins: result.trade.coinsReceived,
        shares: result.trade.shares,
        price: result.trade.avgPrice,
        at: Date.now(),
      });
      publishUnlocks(u.id, result.unlocks);
      return NextResponse.json({ ok: true, ...result });
    }
  } catch (e) {
    if (e instanceof HttpError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof InsufficientFundsError) {
      // safeDebit lost the balance race vs a concurrent debit — surface
      // the same shape as the pre-trade check so the client treats both
      // identically.
      return NextResponse.json({ error: "insufficient_coins" }, { status: 400 });
    }
    logger.error(e, {
      route: "/api/trade",
      userId: u.id,
      marketId: parsed.data.marketId,
      outcome: parsed.data.outcome,
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

async function executeBuy(
  userId: string,
  marketId: string,
  outcome: "YES" | "NO",
  coins: number,
) {
  return db.$transaction(async (tx) => {
    const market = await tx.market.findUnique({ where: { id: marketId } });
    if (!market) throw new HttpError(404, "market_not_found");
    if (market.status !== "OPEN") throw new HttpError(409, "market_not_open");
    if (market.endsAt.getTime() <= Date.now()) {
      throw new HttpError(409, "market_ended");
    }

    const wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new HttpError(404, "wallet_missing");
    if (wallet.balance < coins) throw new HttpError(400, "insufficient_coins");

    // Skim the platform fee FIRST. The AMM then quotes against the net
    // amount, so the user's shares are proportional to what actually
    // entered the pool — the fee never sees the pool, so it can't move
    // the price for other traders.
    const { netCoins, fee } = splitBuy(coins);
    if (netCoins <= 0) throw new HttpError(400, "below_min_after_fee");
    const quote = quoteBuy(
      { yesShares: market.yesShares, noShares: market.noShares },
      outcome,
      netCoins,
    );
    if (!quote) throw new HttpError(400, "quote_failed");
    const charge = chargeForCoins(coins);
    const poolCharge = chargeForCoins(netCoins);

    // Atomic debit guarded against negative balance.
    await safeDebit(tx, userId, charge);

    const updatedMarket = await tx.market.update({
      where: { id: market.id },
      data: {
        yesShares: quote.newReserves.yesShares,
        noShares: quote.newReserves.noShares,
        // Volume tracks the gross trade size (includes fee) — fees are
        // platform revenue, not LP/maker revenue, but they still count as
        // volume in the dashboard sense.
        volumeCoins: { increment: charge },
        trendingScore: { increment: charge },
      },
    });

    const trade = await tx.trade.create({
      data: {
        marketId: market.id,
        userId,
        outcome: outcome as Outcome,
        shares: quote.sharesOut,
        cost: poolCharge,
        feeCoins: fee,
        pricePerShare: quote.avgPrice,
        yesSharesAfter: quote.newReserves.yesShares,
        noSharesAfter: quote.newReserves.noShares,
      },
    });

    // Position costBasis intentionally stores the POOL cost (post-fee).
    // That makes realized PnL at settlement = `payout - poolCost`, which
    // is the user's true profit (the 2% fee is sunk and never recovered).
    await tx.position.upsert({
      where: {
        userId_marketId_outcome: { userId, marketId: market.id, outcome: outcome as Outcome },
      },
      create: {
        userId,
        marketId: market.id,
        outcome: outcome as Outcome,
        shares: quote.sharesOut,
        costBasis: poolCharge,
      },
      update: {
        shares: { increment: quote.sharesOut },
        costBasis: { increment: poolCharge },
      },
    });

    await tx.transaction.create({
      data: {
        userId,
        delta: -charge,
        kind: "trade_buy",
        reference: trade.id,
        metadata: { marketId: market.id, outcome, shares: quote.sharesOut, fee },
      },
    });

    // Book the platform fee on the house wallet inside the same txn.
    // Reference uses the tradeId so a (very rare) retry that lands the
    // same Trade row id can't double-collect.
    await collectFee(tx, {
      amount: fee,
      kind: "commission_buy",
      reference: `buy:${trade.id}`,
      metadata: { marketId: market.id, outcome, takerId: userId },
    });

    await tx.pricePoint.create({
      data: {
        marketId: market.id,
        yesPrice: quote.newYesPrice,
        noPrice: 1 - quote.newYesPrice,
      },
    });

    const xp = Math.min(50, Math.max(1, Math.floor(charge / 20)));
    await tx.user.update({ where: { id: userId }, data: { xp: { increment: xp } } });
    const unlocks = await onTrade(tx, userId, { coinsSpent: charge });

    return {
      trade: {
        id: trade.id,
        shares: quote.sharesOut,
        cost: charge,
        avgPrice: quote.avgPrice,
      },
      market: {
        id: updatedMarket.id,
        title: updatedMarket.title,
        slug: updatedMarket.slug,
        yesPrice: quote.newYesPrice,
        noPrice: 1 - quote.newYesPrice,
        volumeCoins: updatedMarket.volumeCoins,
      },
      xpAwarded: xp,
      unlocks,
    };
  });
}

async function executeSell(
  userId: string,
  marketId: string,
  outcome: "YES" | "NO",
  shares: number,
) {
  return db.$transaction(async (tx) => {
    const market = await tx.market.findUnique({ where: { id: marketId } });
    if (!market) throw new HttpError(404, "market_not_found");
    if (market.status !== "OPEN") throw new HttpError(409, "market_not_open");
    if (market.endsAt.getTime() <= Date.now()) {
      throw new HttpError(409, "market_ended");
    }

    // Must have the shares free (excluding ones locked in SELL orders).
    const pos = await tx.position.findUnique({
      where: {
        userId_marketId_outcome: { userId, marketId: market.id, outcome: outcome as Outcome },
      },
    });
    if (!pos) throw new HttpError(400, "insufficient_shares");
    const available = pos.shares - pos.locked;
    if (available + 1e-9 < shares) throw new HttpError(400, "insufficient_shares");

    const quote = quoteSell(
      { yesShares: market.yesShares, noShares: market.noShares },
      outcome,
      shares,
    );
    if (!quote) throw new HttpError(400, "quote_failed");

    // Whole-coin payout — coinsOut is fractional; round DOWN so we never
    // over-credit on rounding. THIS is gross proceeds; the platform fee
    // is skimmed below.
    const gross = Math.floor(quote.coinsOut);
    if (gross <= 0) throw new HttpError(400, "quote_failed");
    const { netCoins: coinsReceived, fee } = splitSell(gross);
    if (coinsReceived <= 0) throw new HttpError(400, "below_min_after_fee");

    await tx.wallet.update({
      where: { userId },
      data: { balance: { increment: coinsReceived } },
    });

    const updatedMarket = await tx.market.update({
      where: { id: market.id },
      data: {
        yesShares: quote.newReserves.yesShares,
        noShares: quote.newReserves.noShares,
        // Volume tracks the gross sale (includes fee) for analytics parity
        // with the BUY side.
        volumeCoins: { increment: gross },
        trendingScore: { increment: gross },
      },
    });

    const trade = await tx.trade.create({
      data: {
        marketId: market.id,
        userId,
        outcome: outcome as Outcome,
        shares,
        cost: -coinsReceived,
        feeCoins: fee,
        pricePerShare: quote.avgPrice,
        yesSharesAfter: quote.newReserves.yesShares,
        noSharesAfter: quote.newReserves.noShares,
      },
    });

    // Decrement position. Reduce costBasis proportionally so realised P/L
    // on the remaining shares stays accurate.
    const sharesBefore = pos.shares;
    const ratio = (sharesBefore - shares) / sharesBefore;
    await tx.position.update({
      where: { id: pos.id },
      data: {
        shares: { decrement: shares },
        costBasis: Math.max(0, Math.floor(pos.costBasis * ratio)),
        // realizedPnl uses the NET proceeds — the 2% fee really is gone.
        realizedPnl: { increment: coinsReceived - Math.round(pos.costBasis * (1 - ratio)) },
      },
    });

    await tx.transaction.create({
      data: {
        userId,
        delta: coinsReceived,
        kind: "trade_sell",
        reference: trade.id,
        metadata: { marketId: market.id, outcome, shares, fee, gross },
      },
    });

    await collectFee(tx, {
      amount: fee,
      kind: "commission_sell",
      reference: `sell:${trade.id}`,
      metadata: { marketId: market.id, outcome, takerId: userId },
    });

    await tx.pricePoint.create({
      data: {
        marketId: market.id,
        yesPrice: quote.newYesPrice,
        noPrice: 1 - quote.newYesPrice,
      },
    });

    const xp = Math.min(50, Math.max(1, Math.floor(coinsReceived / 20)));
    await tx.user.update({ where: { id: userId }, data: { xp: { increment: xp } } });
    const unlocks = await onTrade(tx, userId, { coinsSpent: coinsReceived });

    return {
      trade: {
        id: trade.id,
        shares,
        coinsReceived,
        avgPrice: quote.avgPrice,
      },
      market: {
        id: updatedMarket.id,
        title: updatedMarket.title,
        slug: updatedMarket.slug,
        yesPrice: quote.newYesPrice,
        noPrice: 1 - quote.newYesPrice,
        volumeCoins: updatedMarket.volumeCoins,
      },
      xpAwarded: xp,
      unlocks,
    };
  });
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
