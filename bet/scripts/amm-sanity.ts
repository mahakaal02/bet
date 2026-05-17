/**
 * Sanity check for the AMM math. Run with:
 *   npx tsx scripts/amm-sanity.ts
 *
 * Verifies:
 *   1. Avg price is always between (marginal_before, 1).
 *   2. Buying drains the YES reserve and lifts the YES marginal price.
 *   3. The "1000 coins at 50/50" case lands near the canonical answer
 *      (avg ≈ 0.67, ~1487 shares).
 *   4. The "1000 coins at marginal 0.80" case beats the simple model:
 *      simple = 1000/0.80 = 1250 shares is an UPPER bound a buyer can't
 *      reach with an AMM; CPMM gives fewer (with avg price > 0.80).
 */
import { quoteBuy, quoteSell, priceYes } from "../lib/amm";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("OK  ", msg);
  }
}

// Case 1: 50/50 pool, buy 1000 YES with 1000 coins
{
  const r = { yesShares: 1000, noShares: 1000 };
  const before = priceYes(r);
  const q = quoteBuy(r, "YES", 1000)!;
  console.log(`\n50/50 + buy 1000:`);
  console.log(`  marginal before: ${before.toFixed(3)}`);
  console.log(`  sharesOut:      ${q.sharesOut.toFixed(2)}`);
  console.log(`  avgPrice:       ${q.avgPrice.toFixed(4)}`);
  console.log(`  marginal after: ${q.newYesPrice.toFixed(3)}`);
  assert(q.avgPrice > before, "avg price > marginal before");
  assert(q.avgPrice < 1, "avg price < 1");
  assert(q.sharesOut > 1000 && q.sharesOut < 2000, "1000<sharesOut<2000");
  assert(q.newYesPrice > before, "marginal price moves up after YES buy");
}

// Case 2: 80% YES marginal price (yes=200 vs no=800), buy 1000 YES with 1000 coins
{
  // priceYes = no/(yes+no). We want priceYes=0.80 → no/(yes+no)=0.80 → yes = no*0.25
  // Pick no=800, yes=200, k=160_000.
  const r = { yesShares: 200, noShares: 800 };
  const before = priceYes(r);
  const q = quoteBuy(r, "YES", 1000)!;
  console.log(`\nmarginal=0.80 + buy 1000:`);
  console.log(`  marginal before: ${before.toFixed(3)}`);
  console.log(`  sharesOut:      ${q.sharesOut.toFixed(2)}`);
  console.log(`  avgPrice:       ${q.avgPrice.toFixed(4)}`);
  console.log(`  marginal after: ${q.newYesPrice.toFixed(3)}`);
  assert(before > 0.79 && before < 0.81, "marginal price = 0.80 ± rounding");
  assert(q.avgPrice > before, "avg > marginal before (slippage)");
  assert(q.avgPrice < 1, "avg < 1");
  // Simple model 1000/0.80 = 1250 is the LIMIT as size→0. CPMM gives fewer.
  assert(q.sharesOut < 1250, "sharesOut < naive size÷price (which is the size→0 limit)");
  assert(q.sharesOut > 800, "sharesOut > 800 (not absurdly small)");
}

// Case 3: tiny trade — avg should hug the marginal price
{
  const r = { yesShares: 1000, noShares: 1000 };
  const q = quoteBuy(r, "YES", 1)!;
  console.log(`\n50/50 + buy 1 coin (tiny):`);
  console.log(`  sharesOut: ${q.sharesOut.toFixed(4)}`);
  console.log(`  avgPrice:  ${q.avgPrice.toFixed(4)}`);
  assert(Math.abs(q.avgPrice - 0.5) < 0.01, "tiny trade avg ≈ marginal");
}

// Case 4: enormous trade vs a thin pool — the slippage guard refuses.
{
  const r = { yesShares: 1000, noShares: 1000 };
  const q = quoteBuy(r, "YES", 1_000_000);
  console.log(`\n50/50 + buy 1,000,000 (huge):`);
  console.log(`  result: ${q === null ? "null (slippage guard tripped)" : q.sharesOut}`);
  assert(q === null, "huge trade vs thin pool is refused");
}

// Case 5: medium-large trade — avg trends toward 1
{
  const r = { yesShares: 1000, noShares: 1000 };
  const q = quoteBuy(r, "YES", 5000)!;
  console.log(`\n50/50 + buy 5,000:`);
  console.log(`  sharesOut: ${q.sharesOut.toFixed(2)}`);
  console.log(`  avgPrice:  ${q.avgPrice.toFixed(4)}`);
  assert(q.avgPrice < 1 && q.avgPrice > 0.5, "medium trade avg > marginal, < 1");
  assert(q.sharesOut > 5000 / 1, "more than 5000 / max-price shares");
}

// Case 6: SELL 100 YES at 50/50
{
  const r = { yesShares: 1000, noShares: 1000 };
  const before = priceYes(r);
  const q = quoteSell(r, "YES", 100)!;
  console.log(`\n50/50 + sell 100 YES:`);
  console.log(`  marginal before: ${before.toFixed(3)}`);
  console.log(`  coinsOut:        ${q.coinsOut.toFixed(2)}`);
  console.log(`  avgPrice:        ${q.avgPrice.toFixed(4)}`);
  console.log(`  marginal after:  ${q.newYesPrice.toFixed(3)}`);
  assert(q.avgPrice > 0, "avg price > 0");
  assert(q.avgPrice < before, "sell avg < marginal before (slippage)");
  assert(q.newYesPrice < before, "YES marginal price drops after sell");
  assert(q.coinsOut > 40 && q.coinsOut < 50, "~48 coins for 100 shares at 50/50");
}

// Case 7: BUY then SELL should give back roughly what you paid (minus 2× fee + slippage)
{
  const r0 = { yesShares: 1000, noShares: 1000 };
  const buy = quoteBuy(r0, "YES", 1000)!;
  const r1 = buy.newReserves;
  const sell = quoteSell(r1, "YES", buy.sharesOut)!;
  const r2 = sell.newReserves;
  console.log(`\nBuy 1000 → Sell back:`);
  console.log(`  bought: ${buy.sharesOut.toFixed(2)} shares for 1000 coins`);
  console.log(`  sold back: ${sell.coinsOut.toFixed(2)} coins`);
  console.log(`  reserves after round-trip: yes=${r2.yesShares.toFixed(2)} no=${r2.noShares.toFixed(2)}`);
  console.log(`  k drift: ${(r0.yesShares*r0.noShares - r2.yesShares*r2.noShares).toFixed(2)} (negative = pool kept some fees)`);
  // Round-trip should return strictly less than the input (LP fee captures some).
  assert(sell.coinsOut < 1000, "round trip loses to fees + slippage");
  assert(sell.coinsOut > 950, "round trip not too lossy (>95% recovery on this size)");
}

// Case 8: SELL impossibly many shares is refused
{
  const r = { yesShares: 1000, noShares: 1000 };
  const q = quoteSell(r, "YES", 100_000);
  console.log(`\nSell 100,000 YES into a 1k/1k pool: ${q === null ? "null" : q.coinsOut}`);
  assert(q === null, "absurd sell is refused");
}
