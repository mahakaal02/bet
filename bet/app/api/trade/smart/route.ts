import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { publish, Channels } from "@/lib/pubsub";
import { onTrade, publishUnlocks } from "@/lib/achievements";
import { routeBuy, routeSell, type RestingOrder } from "@/lib/router";
import { logger } from "@/lib/logger";
import { splitBuy, splitSell } from "@/lib/commission";
import { collectFee } from "@/lib/house";
import { InsufficientFundsError, safeDebit } from "@/lib/wallet-safe";
import type { Outcome } from "@prisma/client";

/**
 * Smart-routed trade endpoint. Picks the cheapest fill across the AMM and
 * the orderbook in one atomic transaction:
 *
 *   1. Lock the market row.
 *   2. Snapshot AMM reserves + opposite-side resting orders.
 *   3. Plan the trade with `routeBuy` / `routeSell`. The plan is a list of
 *      legs — some "book" fills, optionally an "amm" sweep.
 *   4. Reserve user funds (BUY: coins; SELL: shares) up-front for the
 *      full trade.
 *   5. Settle each book fill (maker order, both wallets, taker position,
 *      OrderMatch + Trade rows).
 *   6. Settle the AMM leg (reserves, taker position, Trade row).
 *   7. Refund any over-reserve.
 *
 * On error the transaction rolls back and the user's wallet/positions are
 * untouched. Post-commit we publish a single market price tick (using the
 * final AMM reserves' implied marginal) and a global activity event.
 */
const Body = z.object({
  marketId: z.string().min(1),
  outcome: z.enum(["YES", "NO"]),
  side: z.enum(["BUY", "SELL"]),
  // BUY: coins to spend. SELL: shares to sell. Exactly one is meaningful.
  coins: z.number().int().min(1).max(1_000_000).optional(),
  shares: z.number().gt(0).max(1_000_000).optional(),
});

export async function POST(req: Request) {
  const u = await getAuthedUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limit = rateLimit(`smart:${u.id}`, { limit: 10, windowMs: 10_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const { marketId, outcome, side } = parsed.data;
  if (side === "BUY" && !parsed.data.coins) {
    return NextResponse.json({ error: "missing_coins" }, { status: 400 });
  }
  if (side === "SELL" && !parsed.data.shares) {
    return NextResponse.json({ error: "missing_shares" }, { status: 400 });
  }

  try {
    const result = await db.$transaction(
      async (tx) => {
        const market = await tx.market.findUnique({ where: { id: marketId } });
        if (!market) throw new HttpError(404, "market_not_found");
        if (market.status !== "OPEN") throw new HttpError(409, "market_not_open");
        if (market.endsAt.getTime() <= Date.now()) {
          throw new HttpError(409, "market_ended");
        }

        const oppositeSide = side === "BUY" ? "SELL" : "BUY";
        const restingRows = await tx.order.findMany({
          where: {
            marketId: market.id,
            outcome: outcome as Outcome,
            side: oppositeSide,
            status: { in: ["OPEN", "PARTIAL"] },
          },
          orderBy: [
            side === "BUY" ? { limitPrice: "asc" } : { limitPrice: "desc" },
            { createdAt: "asc" },
          ],
          take: 200,
        });
        const resting: RestingOrder[] = restingRows.map((r) => ({
          id: r.id,
          userId: r.userId,
          limitPrice: r.limitPrice,
          remaining: r.remaining,
        }));
        const reserves = {
          yesShares: market.yesShares,
          noShares: market.noShares,
        };

        // Skim the buy-side platform fee BEFORE planning so the router
        // distributes the user's *net* contribution across book + AMM —
        // the fee never sees the pool or the maker. On the sell side we
        // skim AFTER the plan settles (per-leg legs aggregate to gross
        // proceeds, then 2% comes off the total before the user is paid).
        const buyGross = side === "BUY" ? Math.floor(parsed.data.coins!) : 0;
        const buyFeeSplit = side === "BUY" ? splitBuy(buyGross) : { netCoins: 0, fee: 0 };
        if (side === "BUY" && buyFeeSplit.netCoins <= 0) {
          throw new HttpError(400, "below_min_after_fee");
        }

        // Plan.
        let plan;
        if (side === "BUY") {
          plan = routeBuy({
            takerUserId: u.id,
            outcome,
            coins: buyFeeSplit.netCoins,
            reserves,
            resting,
          });
        } else {
          plan = routeSell({
            takerUserId: u.id,
            outcome,
            shares: parsed.data.shares!,
            reserves,
            resting,
          });
        }
        if (!plan) throw new HttpError(400, "quote_failed");

        // Reserve user funds for the full trade.
        if (side === "BUY") {
          // Reserve = legs' total (net) + 2% platform fee — i.e. the gross
          // coin amount the user intended to spend. `safeDebit` will throw
          // InsufficientFundsError on a balance race, and the outer
          // transaction rolls back atomically.
          const need = Math.ceil(plan.totalCoins) + buyFeeSplit.fee;
          await safeDebit(tx, u.id, need);
        } else {
          const pos = await tx.position.findUnique({
            where: {
              userId_marketId_outcome: {
                userId: u.id,
                marketId: market.id,
                outcome: outcome as Outcome,
              },
            },
          });
          const available = (pos?.shares ?? 0) - (pos?.locked ?? 0);
          if (available + 1e-9 < plan.totalShares) {
            throw new HttpError(400, "insufficient_shares");
          }
        }

        // Execute legs.
        let lastFillPrice: number | null = null;
        let finalReserves = reserves;

        for (const leg of plan.legs) {
          if (leg.kind === "book") {
            const maker = restingRows.find((r) => r.id === leg.makerOrderId)!;
            const newRemaining = maker.remaining - leg.shares;
            await tx.order.update({
              where: { id: maker.id },
              data: {
                remaining: newRemaining,
                filledShares: { increment: leg.shares },
                filledCost: { increment: Math.round(leg.coins) },
                status: deriveStatus(newRemaining, maker.shares),
                ...(newRemaining <= 1e-9 && { filledAt: new Date() }),
              },
            });

            const fillCoins = Math.round(leg.coins);
            if (side === "BUY") {
              // Maker was a SELL — release locked shares, debit shares, credit
              // coins.
              await tx.position.update({
                where: {
                  userId_marketId_outcome: {
                    userId: maker.userId,
                    marketId: market.id,
                    outcome: outcome as Outcome,
                  },
                },
                data: {
                  shares: { decrement: leg.shares },
                  locked: { decrement: leg.shares },
                },
              });
              await tx.wallet.update({
                where: { userId: maker.userId },
                data: { balance: { increment: fillCoins } },
              });
              // Credit taker the shares.
              await tx.position.upsert({
                where: {
                  userId_marketId_outcome: {
                    userId: u.id,
                    marketId: market.id,
                    outcome: outcome as Outcome,
                  },
                },
                create: {
                  userId: u.id,
                  marketId: market.id,
                  outcome: outcome as Outcome,
                  shares: leg.shares,
                  costBasis: fillCoins,
                },
                update: {
                  shares: { increment: leg.shares },
                  costBasis: { increment: fillCoins },
                },
              });
            } else {
              // SELL taker — maker was a BUY. Refund maker the over-lock,
              // give maker the shares, credit taker the coins, debit taker
              // shares.
              const refund = Math.round(
                leg.shares * (maker.limitPrice - leg.price),
              );
              if (refund > 0) {
                await tx.wallet.update({
                  where: { userId: maker.userId },
                  data: { balance: { increment: refund } },
                });
              }
              await tx.position.upsert({
                where: {
                  userId_marketId_outcome: {
                    userId: maker.userId,
                    marketId: market.id,
                    outcome: outcome as Outcome,
                  },
                },
                create: {
                  userId: maker.userId,
                  marketId: market.id,
                  outcome: outcome as Outcome,
                  shares: leg.shares,
                  costBasis: fillCoins,
                },
                update: {
                  shares: { increment: leg.shares },
                  costBasis: { increment: fillCoins },
                },
              });
              await tx.position.update({
                where: {
                  userId_marketId_outcome: {
                    userId: u.id,
                    marketId: market.id,
                    outcome: outcome as Outcome,
                  },
                },
                data: { shares: { decrement: leg.shares } },
              });
              await tx.wallet.update({
                where: { userId: u.id },
                data: { balance: { increment: fillCoins } },
              });
            }

            // Trade + OrderMatch + notification.
            const trade = await tx.trade.create({
              data: {
                marketId: market.id,
                userId: u.id,
                outcome: outcome as Outcome,
                shares: leg.shares,
                cost: side === "BUY" ? fillCoins : -fillCoins,
                pricePerShare: leg.price,
                yesSharesAfter: finalReserves.yesShares,
                noSharesAfter: finalReserves.noShares,
              },
            });
            await tx.transaction.create({
              data: {
                userId: u.id,
                delta: side === "BUY" ? -fillCoins : fillCoins,
                kind: side === "BUY" ? "smart_buy_book" : "smart_sell_book",
                reference: trade.id,
                metadata: { marketId: market.id, outcome, makerOrderId: maker.id },
              },
            });
            await tx.orderMatch.create({
              data: {
                marketId: market.id,
                outcome: outcome as Outcome,
                shares: leg.shares,
                price: leg.price,
                // We don't create a taker Order row for smart trades —
                // they're market-order semantics, not resting. Point the
                // taker order id at the maker (best we can do for the FK).
                takerOrderId: maker.id,
                makerOrderId: maker.id,
                takerUserId: u.id,
                makerUserId: maker.userId,
                takerSide: side,
              },
            });
            await tx.notification.create({
              data: {
                userId: maker.userId,
                title: maker.side === "BUY" ? "Buy order filled" : "Sell order filled",
                body: `${leg.shares.toFixed(2)} ${outcome} @ ${leg.price.toFixed(2)} on “${market.title}”.`,
                href: `/markets/${market.slug}`,
              },
            });
            lastFillPrice = leg.price;
          } else {
            // AMM leg.
            const fillCoins = side === "BUY" ? Math.ceil(leg.input) : Math.floor(leg.output);
            const fillShares = side === "BUY" ? leg.output : leg.input;
            const ammMarginal = side === "BUY"
              ? (outcome === "YES" ? leg.newReserves.noShares / (leg.newReserves.yesShares + leg.newReserves.noShares) : leg.newReserves.yesShares / (leg.newReserves.yesShares + leg.newReserves.noShares))
              : (outcome === "YES" ? leg.newReserves.noShares / (leg.newReserves.yesShares + leg.newReserves.noShares) : leg.newReserves.yesShares / (leg.newReserves.yesShares + leg.newReserves.noShares));

            await tx.market.update({
              where: { id: market.id },
              data: {
                yesShares: leg.newReserves.yesShares,
                noShares: leg.newReserves.noShares,
                volumeCoins: { increment: fillCoins },
                trendingScore: { increment: fillCoins },
              },
            });
            finalReserves = leg.newReserves;

            if (side === "BUY") {
              await tx.position.upsert({
                where: {
                  userId_marketId_outcome: {
                    userId: u.id,
                    marketId: market.id,
                    outcome: outcome as Outcome,
                  },
                },
                create: {
                  userId: u.id,
                  marketId: market.id,
                  outcome: outcome as Outcome,
                  shares: fillShares,
                  costBasis: fillCoins,
                },
                update: {
                  shares: { increment: fillShares },
                  costBasis: { increment: fillCoins },
                },
              });
            } else {
              await tx.position.update({
                where: {
                  userId_marketId_outcome: {
                    userId: u.id,
                    marketId: market.id,
                    outcome: outcome as Outcome,
                  },
                },
                data: { shares: { decrement: fillShares } },
              });
              await tx.wallet.update({
                where: { userId: u.id },
                data: { balance: { increment: fillCoins } },
              });
            }
            const trade = await tx.trade.create({
              data: {
                marketId: market.id,
                userId: u.id,
                outcome: outcome as Outcome,
                shares: fillShares,
                cost: side === "BUY" ? fillCoins : -fillCoins,
                pricePerShare: fillCoins / fillShares,
                yesSharesAfter: leg.newReserves.yesShares,
                noSharesAfter: leg.newReserves.noShares,
              },
            });
            await tx.transaction.create({
              data: {
                userId: u.id,
                delta: side === "BUY" ? -fillCoins : fillCoins,
                kind: side === "BUY" ? "smart_buy_amm" : "smart_sell_amm",
                reference: trade.id,
                metadata: { marketId: market.id, outcome, fillCoins, fillShares },
              },
            });
            await tx.pricePoint.create({
              data: {
                marketId: market.id,
                yesPrice: outcome === "YES" ? ammMarginal : 1 - ammMarginal,
                noPrice: outcome === "YES" ? 1 - ammMarginal : ammMarginal,
              },
            });
            lastFillPrice = ammMarginal;
          }
        }

        // XP + achievements based on the total notional.
        const totalNotional = side === "BUY" ? Math.ceil(plan.totalCoins) : Math.floor(plan.totalCoins);
        const xp = Math.min(50, Math.max(1, Math.floor(totalNotional / 20)));
        await tx.user.update({
          where: { id: u.id },
          data: { xp: { increment: xp } },
        });
        const unlocks = await onTrade(tx, u.id, { coinsSpent: totalNotional });

        // BUY: refund the over-reserve (we debited ceil(plan.totalCoins) +
        // fee; actual leg execution rounds down per-leg). The fee itself
        // does NOT get refunded — that goes to the house below.
        // SELL: skim the platform fee from the user's net proceeds. The
        // per-leg credits above gave the user the gross; debit the fee
        // back here so the wallet net effect matches "gross × 0.98".
        let sellFee = 0;
        if (side === "BUY") {
          const reserved = Math.ceil(plan.totalCoins);
          const actual = plan.legs.reduce((s, leg) => {
            if (leg.kind === "book") return s + Math.round(leg.coins);
            return s + Math.ceil(leg.input);
          }, 0);
          if (reserved > actual) {
            await tx.wallet.update({
              where: { userId: u.id },
              data: { balance: { increment: reserved - actual } },
            });
          }
          await collectFee(tx, {
            amount: buyFeeSplit.fee,
            kind: "commission_buy",
            // Reference scopes by (market, taker, timestamp): the smart
            // route doesn't fold every leg into one Trade row, so we use
            // a synthetic id so retries are still idempotent.
            reference: `smart-buy:${market.id}:${u.id}:${Date.now()}`,
            metadata: {
              marketId: market.id,
              outcome,
              takerId: u.id,
              gross: buyGross,
              net: buyFeeSplit.netCoins,
              legs: plan.legs.length,
            },
          });
        } else {
          // SELL — sum the actual coins the user was credited across legs.
          // Skim 2% off that total. Floor() so the user under-pays the fee
          // by at most 1 coin rather than the other way around.
          const grossProceeds = plan.legs.reduce((s, leg) => {
            if (leg.kind === "book") return s + Math.round(leg.coins);
            return s + Math.floor(leg.output);
          }, 0);
          const split = splitSell(grossProceeds);
          sellFee = split.fee;
          if (sellFee > 0) {
            // Pull the fee out of the user's wallet. They were already
            // credited the gross by the per-leg increments above; this
            // brings the net to gross × 0.98.
            await safeDebit(tx, u.id, sellFee);
            await collectFee(tx, {
              amount: sellFee,
              kind: "commission_sell",
              reference: `smart-sell:${market.id}:${u.id}:${Date.now()}`,
              metadata: {
                marketId: market.id,
                outcome,
                takerId: u.id,
                gross: grossProceeds,
                net: split.netCoins,
                legs: plan.legs.length,
              },
            });
          }
        }

        return {
          plan,
          finalReserves,
          lastFillPrice,
          unlocks,
          marketSlug: market.slug,
          marketTitle: market.title,
          marketId: market.id,
          buyFee: buyFeeSplit.fee,
          sellFee,
        };
      },
      { timeout: 30_000 },
    );

    // Broadcast.
    const yesPrice =
      result.finalReserves.noShares /
      (result.finalReserves.yesShares + result.finalReserves.noShares);
    publish(Channels.market(result.marketId), {
      type: "trade",
      yesPrice,
      noPrice: 1 - yesPrice,
      side: outcome,
      action: side,
      cost: Math.round(result.plan.totalCoins),
      at: Date.now(),
    });
    publish(Channels.market(result.marketId), {
      type: "book",
      at: Date.now(),
    });
    publish(Channels.global(), {
      type: "activity",
      marketId: result.marketId,
      marketTitle: result.marketTitle,
      marketSlug: result.marketSlug,
      action: side,
      outcome,
      username: u.username,
      coins: Math.round(result.plan.totalCoins),
      shares: result.plan.totalShares,
      price: result.lastFillPrice ?? result.plan.avgPrice,
      at: Date.now(),
    });
    publishUnlocks(u.id, result.unlocks);

    return NextResponse.json({
      ok: true,
      plan: {
        side: result.plan.side,
        totalCoins: result.plan.totalCoins,
        totalShares: result.plan.totalShares,
        avgPrice: result.plan.avgPrice,
        legs: result.plan.legs.map((l) => ({
          kind: l.kind,
          ...(l.kind === "book"
            ? { price: l.price, shares: l.shares, coins: l.coins }
            : { input: l.input, output: l.output }),
        })),
      },
    });
  } catch (e) {
    if (e instanceof HttpError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof InsufficientFundsError) {
      return NextResponse.json({ error: "insufficient_coins" }, { status: 400 });
    }
    logger.error(e, { route: "/api/trade/smart", userId: u.id, marketId, outcome, side });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

function deriveStatus(remaining: number, original: number) {
  if (remaining <= 1e-9) return "FILLED" as const;
  if (remaining < original - 1e-9) return "PARTIAL" as const;
  return "OPEN" as const;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
