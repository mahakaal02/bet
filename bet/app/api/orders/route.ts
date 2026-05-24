import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { publish, Channels } from "@/lib/pubsub";
import { onTrade, publishUnlocks } from "@/lib/achievements";
import {
  matchIncoming,
  snapPrice,
  snapShares,
  type IncomingOrder,
  type RestingOrder,
} from "@/lib/orderbook";
import { logger } from "@/lib/logger";
import type { Outcome, OrderSide, OrderStatus } from "@prisma/client";

const Body = z.object({
  marketId: z.string().min(1),
  outcome: z.enum(["YES", "NO"]),
  side: z.enum(["BUY", "SELL"]),
  limitPrice: z.number().gt(0).lt(1),
  shares: z.number().gt(0).max(100_000),
});

/**
 * Place a limit order. Atomic flow:
 *   1. Validate, snap inputs to canonical grid (0.01 prices, 4dp shares).
 *   2. Lock funds (BUY: shares*limit coins) or shares (SELL: shares of Position).
 *   3. Load resting opposite-side orders, run matcher.
 *   4. For each fill: settle coins both ways, mutate maker order remaining,
 *      mutate taker positions, mutate maker positions, write Trade rows,
 *      write OrderMatch row.
 *   5. Persist taker order with the unfilled remainder (or FILLED).
 *   6. Refund the BUY-side over-lock when the matched price was better than
 *      the taker's limit (price improvement).
 */
export async function POST(req: Request) {
  const u = await getAuthedUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limit = rateLimit(`order:${u.id}`, { limit: 10, windowMs: 10_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", details: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;
  const price = snapPrice(input.limitPrice);
  const shares = snapShares(input.shares);
  if (!Number.isFinite(price) || !Number.isFinite(shares)) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const market = await tx.market.findUnique({ where: { id: input.marketId } });
      if (!market) throw new HttpError(404, "market_not_found");
      if (market.status !== "OPEN") throw new HttpError(409, "market_not_open");
      if (market.endsAt.getTime() <= Date.now()) {
        throw new HttpError(409, "market_ended");
      }

      // 1. Lock funds / shares up-front for the FULL incoming size. We'll
      //    refund the difference if the average fill price is better.
      const coinReserve = input.side === "BUY" ? Math.ceil(shares * price) : 0;
      const shareReserve = input.side === "SELL" ? shares : 0;

      if (input.side === "BUY") {
        const wallet = await tx.wallet.findUnique({ where: { userId: u.id } });
        if (!wallet || wallet.balance < coinReserve) {
          throw new HttpError(400, "insufficient_coins");
        }
        await tx.wallet.update({
          where: { userId: u.id },
          data: { balance: { decrement: coinReserve } },
        });
      } else {
        const pos = await tx.position.findUnique({
          where: {
            userId_marketId_outcome: {
              userId: u.id,
              marketId: market.id,
              outcome: input.outcome as Outcome,
            },
          },
        });
        const available = (pos?.shares ?? 0) - (pos?.locked ?? 0);
        if (available + 1e-9 < shareReserve) {
          throw new HttpError(400, "insufficient_shares");
        }
        await tx.position.update({
          where: { id: pos!.id },
          data: { locked: { increment: shareReserve } },
        });
      }

      // 2. Load the opposite-side resting orders for this market+outcome.
      const oppositeSide: OrderSide = input.side === "BUY" ? "SELL" : "BUY";
      const restingRows = await tx.order.findMany({
        where: {
          marketId: market.id,
          outcome: input.outcome as Outcome,
          side: oppositeSide,
          status: { in: ["OPEN", "PARTIAL"] },
        },
        orderBy: [
          // The matcher re-sorts internally but giving Postgres a head start
          // is free and cuts the candidate set in big books.
          input.side === "BUY"
            ? { limitPrice: "asc" }
            : { limitPrice: "desc" },
          { createdAt: "asc" },
        ],
        take: 200,
      });

      const restingPool: RestingOrder[] = restingRows.map((r) => ({
        id: r.id,
        userId: r.userId,
        side: r.side,
        limitPrice: r.limitPrice,
        remaining: r.remaining,
        createdAt: r.createdAt,
      }));

      const incoming: IncomingOrder = {
        userId: u.id,
        side: input.side,
        limitPrice: price,
        shares,
      };
      const matched = matchIncoming(incoming, restingPool);

      // 3. Insert the taker order. We update it again below with the final
      //    remaining + status, but having a row first means OrderMatch FKs
      //    don't dangle if a fill happens.
      const filledShares = shares - matched.remaining;
      const takerOrder = await tx.order.create({
        data: {
          userId: u.id,
          marketId: market.id,
          outcome: input.outcome as Outcome,
          side: input.side,
          limitPrice: price,
          shares,
          remaining: matched.remaining,
          filledShares,
          filledCost: 0, // recomputed below
          status: deriveStatus(matched.remaining, shares),
        },
      });

      // 4. Settle each fill.
      let totalSettled = 0;
      let achievementUnlocks: Awaited<ReturnType<typeof onTrade>> = [];
      for (const fill of matched.fills) {
        const fillShares = fill.shares;
        const fillCoins = Math.round(fillShares * fill.price);
        totalSettled += fillCoins;

        // 4a. Update maker order.
        const maker = restingRows.find((r) => r.id === fill.makerOrderId)!;
        const makerNewRemaining = maker.remaining - fillShares;
        await tx.order.update({
          where: { id: maker.id },
          data: {
            remaining: makerNewRemaining,
            filledShares: { increment: fillShares },
            filledCost: { increment: fillCoins },
            status: deriveStatus(makerNewRemaining, maker.shares),
            ...(makerNewRemaining <= 1e-9 && { filledAt: new Date() }),
          },
        });

        // 4b. Update maker funds.
        if (maker.side === "SELL") {
          // Maker delivered shares — release the locked shares for the
          // filled portion, then debit the actual share count from Position.
          await tx.position.update({
            where: {
              userId_marketId_outcome: {
                userId: maker.userId,
                marketId: market.id,
                outcome: input.outcome as Outcome,
              },
            },
            data: {
              shares: { decrement: fillShares },
              locked: { decrement: fillShares },
              costBasis: { decrement: 0 }, // costBasis lowered proportionally below via realizedPnl
            },
          });
          await tx.wallet.update({
            where: { userId: maker.userId },
            data: { balance: { increment: fillCoins } },
          });
        } else {
          // Maker was a BUY — coins were locked at maker.limit when posted;
          // refund the over-lock (maker.limit - fill.price) per share.
          const refund = Math.round(fillShares * (maker.limitPrice - fill.price));
          if (refund > 0) {
            await tx.wallet.update({
              where: { userId: maker.userId },
              data: { balance: { increment: refund } },
            });
          }
          // Credit maker the shares.
          await upsertPosition(tx, maker.userId, market.id, input.outcome as Outcome, {
            sharesDelta: fillShares,
            costBasisDelta: fillCoins,
          });
        }

        // 4c. Update taker funds.
        if (input.side === "BUY") {
          await upsertPosition(tx, u.id, market.id, input.outcome as Outcome, {
            sharesDelta: fillShares,
            costBasisDelta: fillCoins,
          });
        } else {
          // SELL taker — release locked shares for the filled portion and
          // remove them from `shares`. Credit the user.
          await tx.position.update({
            where: {
              userId_marketId_outcome: {
                userId: u.id,
                marketId: market.id,
                outcome: input.outcome as Outcome,
              },
            },
            data: {
              shares: { decrement: fillShares },
              locked: { decrement: fillShares },
            },
          });
          await tx.wallet.update({
            where: { userId: u.id },
            data: { balance: { increment: fillCoins } },
          });
        }

        // 4d. OrderMatch + Trade rows. We mirror the Trade shape used for
        //     AMM fills so portfolio / recent-trades widgets don't need to
        //     learn about two formats.
        const trade = await tx.trade.create({
          data: {
            marketId: market.id,
            userId: u.id,
            outcome: input.outcome as Outcome,
            shares: fillShares,
            cost: input.side === "BUY" ? fillCoins : -fillCoins,
            pricePerShare: fill.price,
            yesSharesAfter: market.yesShares,
            noSharesAfter: market.noShares,
          },
        });
        await tx.transaction.create({
          data: {
            userId: u.id,
            delta: input.side === "BUY" ? -fillCoins : fillCoins,
            kind: input.side === "BUY" ? "order_buy_fill" : "order_sell_fill",
            reference: trade.id,
            metadata: { marketId: market.id, outcome: input.outcome, orderId: takerOrder.id },
          },
        });
        await tx.orderMatch.create({
          data: {
            marketId: market.id,
            outcome: input.outcome as Outcome,
            shares: fillShares,
            price: fill.price,
            takerOrderId: takerOrder.id,
            makerOrderId: maker.id,
            takerUserId: u.id,
            makerUserId: maker.userId,
            takerSide: input.side,
          },
        });

        // 4e. Volume + price point (for the chart). The orderbook's
        // canonical "price" is the last trade price.
        await tx.market.update({
          where: { id: market.id },
          data: { volumeCoins: { increment: fillCoins } },
        });
        await tx.pricePoint.create({
          data: {
            marketId: market.id,
            yesPrice:
              input.outcome === "YES" ? fill.price : 1 - fill.price,
            noPrice:
              input.outcome === "YES" ? 1 - fill.price : fill.price,
          },
        });

        // 4f. Notify the maker their order filled.
        await tx.notification.create({
          data: {
            userId: maker.userId,
            title: maker.side === "BUY" ? "Buy order filled" : "Sell order filled",
            body: `${fillShares.toFixed(2)} ${input.outcome} @ ${fill.price.toFixed(2)} on “${market.title}”.`,
            href: `/markets/${market.slug}`,
          },
        });
      }

      // 5. Refund the BUY-side over-lock from price improvement.
      if (input.side === "BUY" && filledShares > 0) {
        const actualSpend = totalSettled;
        const lockedForFilled = Math.ceil(filledShares * price);
        const refund = lockedForFilled - actualSpend;
        if (refund > 0) {
          await tx.wallet.update({
            where: { userId: u.id },
            data: { balance: { increment: refund } },
          });
        }
      }

      // 6. Update the taker order with the final filledCost so /api/orders
      //    can render the realised cost without re-summing OrderMatch rows.
      await tx.order.update({
        where: { id: takerOrder.id },
        data: {
          filledCost: input.side === "BUY" ? totalSettled : -totalSettled,
          ...(matched.remaining <= 1e-9 && { filledAt: new Date() }),
        },
      });

      // 7. Achievements. matchIncoming may produce multiple fills — for the
      //    achievement engine treat the whole order as one trade (which is
      //    how the user sees it). coinsSpent is what the taker actually paid.
      if (filledShares > 0) {
        achievementUnlocks = await onTrade(tx, u.id, {
          coinsSpent: input.side === "BUY" ? totalSettled : Math.round(filledShares * price),
        });
      }

      return {
        order: {
          id: takerOrder.id,
          status: deriveStatus(matched.remaining, shares),
          remaining: matched.remaining,
          filledShares,
          filledCost: input.side === "BUY" ? totalSettled : totalSettled,
        },
        fills: matched.fills.map((f) => ({
          shares: f.shares,
          price: f.price,
        })),
        market: { id: market.id, slug: market.slug, title: market.title },
        achievementUnlocks,
        lastFillPrice: matched.fills.at(-1)?.price ?? null,
      };
    });

    // Post-commit fan-out: SSE listeners learn about the new state.
    if (result.fills.length > 0 && result.lastFillPrice !== null) {
      const fillCoins = result.fills.reduce((s, f) => s + f.shares * f.price, 0);
      const fillShares = result.fills.reduce((s, f) => s + f.shares, 0);
      publish(Channels.market(result.market.id), {
        type: "trade",
        yesPrice:
          parsed.data.outcome === "YES"
            ? result.lastFillPrice
            : 1 - result.lastFillPrice,
        noPrice:
          parsed.data.outcome === "YES"
            ? 1 - result.lastFillPrice
            : result.lastFillPrice,
        side: parsed.data.outcome,
        action: input.side,
        cost: fillCoins,
        at: Date.now(),
      });
      // Global activity ticker — every fill across every market.
      publish(Channels.global(), {
        type: "activity",
        marketId: result.market.id,
        marketTitle: result.market.title,
        marketSlug: result.market.slug,
        action: input.side,
        outcome: parsed.data.outcome,
        username: u.username,
        coins: Math.round(fillCoins),
        shares: fillShares,
        price: result.lastFillPrice,
        at: Date.now(),
      });
    }
    // Always publish a book change — even an unmatched limit changes the
    // ladder for everyone subscribed to this market.
    publish(Channels.market(result.market.id), {
      type: "book",
      at: Date.now(),
    });
    publishUnlocks(u.id, result.achievementUnlocks);

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof HttpError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    logger.error(e, {
      route: "/api/orders",
      userId: u.id,
      marketId: input.marketId,
      side: input.side,
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

/**
 * List the user's recent orders (open + closed). When `?marketId=…` is
 * supplied, scopes to that market only — the per-market "Your orders"
 * panel needs this so an OPEN order on market A doesn't bleed into the
 * panel on market B's page (where it could be cancelled by the user
 * against the wrong market). Accepts either the market's id or its slug,
 * matching the rest of the public surface.
 */
export async function GET(req: Request) {
  const u = await getAuthedUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const marketIdOrSlug = url.searchParams.get("marketId");

  let marketId: string | undefined;
  if (marketIdOrSlug) {
    const m = await db.market.findFirst({
      where: { OR: [{ id: marketIdOrSlug }, { slug: marketIdOrSlug }] },
      select: { id: true },
    });
    // Unknown market → empty list rather than 404; the panel is best-effort
    // and a stale slug from a deleted market shouldn't break the page.
    if (!m) return NextResponse.json({ orders: [] });
    marketId = m.id;
  }

  const orders = await db.order.findMany({
    where: { userId: u.id, ...(marketId && { marketId }) },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { market: { select: { slug: true, title: true } } },
  });
  return NextResponse.json({ orders });
}

function deriveStatus(remaining: number, original: number): OrderStatus {
  if (remaining <= 1e-9) return "FILLED";
  if (remaining < original - 1e-9) return "PARTIAL";
  return "OPEN";
}

async function upsertPosition(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  userId: string,
  marketId: string,
  outcome: Outcome,
  delta: { sharesDelta: number; costBasisDelta: number },
) {
  await tx.position.upsert({
    where: { userId_marketId_outcome: { userId, marketId, outcome } },
    create: {
      userId,
      marketId,
      outcome,
      shares: delta.sharesDelta,
      costBasis: delta.costBasisDelta,
    },
    update: {
      shares: { increment: delta.sharesDelta },
      costBasis: { increment: delta.costBasisDelta },
    },
  });
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
