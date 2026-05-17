/**
 * One-time backfill: credit positions the shares they SHOULD have received
 * under the corrected AMM math. Idempotent — keyed on a Transaction with
 * `kind="amm_bug_compensation"` and `reference="trade:<tradeId>"`.
 *
 * Background: before this patch, `quoteBuy` in lib/amm.ts only credited
 * the pool's transfer (`yesBefore - yesAfter`) to the buyer, omitting the
 * `c` shares that come from splitting the user's deposited coins. Since
 * the reserves WERE updated correctly, we can identify the missing portion
 * exactly: it's `c = cost * (1 - feeBps/10_000)` per AMM trade.
 *
 * Orderbook trades (kind="order_buy_fill" / "order_sell_fill") are not
 * affected — their math was always correct.
 *
 * Run with:  npx tsx scripts/backfill-amm-bug.ts
 *            npx tsx scripts/backfill-amm-bug.ts --dry  (preview)
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const DRY = process.argv.includes("--dry");

// Same constant as lib/amm.ts.
const FEE_BPS = 100;

async function main() {
  // We need to identify "AMM trades" — the pre-orderbook trades, which used
  // kind="trade_buy" in their Transaction. Each one represents a buy where
  // the user paid `cost` coins for `shares` YES/NO shares, but should have
  // received `shares + c` where c = floor(cost * (1 - fee)).
  const ammTxns = await db.transaction.findMany({
    where: { kind: "trade_buy" },
    orderBy: { createdAt: "asc" },
  });

  console.log(
    `Found ${ammTxns.length} AMM-style transactions to check${DRY ? " (DRY RUN)" : ""}.`,
  );

  let credited = 0;
  let skipped = 0;
  let creditedShares = 0;

  for (const txn of ammTxns) {
    const tradeId = txn.reference;
    if (!tradeId) {
      skipped += 1;
      continue;
    }

    // Already compensated? (idempotency)
    const already = await db.transaction.findUnique({
      where: {
        uniq_kind_reference: {
          kind: "amm_bug_compensation",
          reference: `trade:${tradeId}`,
        },
      },
    });
    if (already) {
      skipped += 1;
      continue;
    }

    const trade = await db.trade.findUnique({ where: { id: tradeId } });
    if (!trade) {
      skipped += 1;
      continue;
    }

    const cost = trade.cost;              // gross coins user paid
    const c = Math.floor(cost * (1 - FEE_BPS / 10_000));
    if (c <= 0) {
      skipped += 1;
      continue;
    }

    if (DRY) {
      console.log(
        `  would credit user=${trade.userId} market=${trade.marketId} outcome=${trade.outcome}: +${c} shares (was ${trade.shares.toFixed(2)})`,
      );
      credited += 1;
      creditedShares += c;
      continue;
    }

    await db.$transaction(async (tx) => {
      // 1. Add the missing shares to the user's Position (costBasis unchanged).
      await tx.position.upsert({
        where: {
          userId_marketId_outcome: {
            userId: trade.userId,
            marketId: trade.marketId,
            outcome: trade.outcome,
          },
        },
        create: {
          userId: trade.userId,
          marketId: trade.marketId,
          outcome: trade.outcome,
          shares: c,
          costBasis: 0,
        },
        update: { shares: { increment: c } },
      });

      // 2. Update the Trade row so portfolio/recent-trades show the correct
      //    delivered share count and average price going forward.
      await tx.trade.update({
        where: { id: trade.id },
        data: {
          shares: trade.shares + c,
          pricePerShare: trade.cost / (trade.shares + c),
        },
      });

      // 3. Audit row. Unique on (kind, reference) so re-runs no-op.
      await tx.transaction.create({
        data: {
          userId: trade.userId,
          delta: 0,
          kind: "amm_bug_compensation",
          reference: `trade:${trade.id}`,
          metadata: {
            addedShares: c,
            tradeId: trade.id,
            originalShares: trade.shares,
            originalAvgPrice: cost / trade.shares,
          },
        },
      });

      // 4. Notify the user.
      const market = await tx.market.findUnique({
        where: { id: trade.marketId },
        select: { title: true, slug: true },
      });
      if (market) {
        await tx.notification.create({
          data: {
            userId: trade.userId,
            title: "Position corrected",
            body: `Fixed an AMM math bug — your trade on “${market.title}” now reflects ${(trade.shares + c).toFixed(2)} ${trade.outcome} shares (was ${trade.shares.toFixed(2)}).`,
            href: `/markets/${market.slug}`,
          },
        });
      }
    });

    credited += 1;
    creditedShares += c;
  }

  console.log(
    `\nDone. credited=${credited}  skipped=${skipped}  total shares added=${creditedShares.toFixed(0)}`,
  );
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
