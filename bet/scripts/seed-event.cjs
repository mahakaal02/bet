/* One-off: seed a Kalshi-style EVENT (MarketGroup) with candidate child
   markets, price history and a few trades, so the event-detail redesign has
   real data to render. Idempotent on slug "la-mayor-2026". */
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

const GROUP_SLUG = "la-mayor-2026";

// yesPrice = noShares/(yes+noShares). To target a YES probability p with
// total liquidity L: noShares = p*L, yesShares = (1-p)*L.
function reservesFor(p, L = 4000) {
  return { yesShares: Math.round((1 - p) * L), noShares: Math.round(p * L) };
}

const CANDS = [
  { slug: "la-mayor-bass", title: "Karen Bass", p: 0.48, vol: 412000, series: [0.38,0.4,0.42,0.43,0.44,0.45,0.46,0.47,0.48] },
  { slug: "la-mayor-caruso", title: "Rick Caruso", p: 0.31, vol: 318000, series: [0.37,0.36,0.35,0.34,0.33,0.32,0.32,0.31,0.31] },
  { slug: "la-mayor-villar", title: "Antonio Villaraigosa", p: 0.09, vol: 96000, series: [0.13,0.12,0.12,0.11,0.11,0.1,0.1,0.09,0.09] },
  { slug: "la-mayor-deleon", title: "Kevin de León", p: 0.05, vol: 62000, series: [0.06,0.06,0.06,0.05,0.05,0.05,0.05,0.05,0.05] },
  { slug: "la-mayor-feuer", title: "Mike Feuer", p: 0.03, vol: 28000, series: [0.04,0.04,0.04,0.03,0.03,0.03,0.03,0.03,0.03] },
  { slug: "la-mayor-other", title: "Any other candidate", p: 0.02, vol: 14000, series: [0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02] },
];

async function main() {
  const user = await db.user.findFirst({ select: { id: true } });
  const endsAt = new Date("2026-11-03T00:00:00Z");

  const group = await db.marketGroup.upsert({
    where: { slug: GROUP_SLUG },
    update: {},
    create: {
      slug: GROUP_SLUG,
      title: "Who will win the 2026 LA mayoral election?",
      description:
        "Mutually-exclusive market on the next Mayor of Los Angeles. One candidate resolves YES; all others resolve NO. Resolves to the certified winner of the November 2026 general election.",
      category: "POLITICS",
      type: "EXCLUSIVE",
      status: "OPEN",
      featured: true,
    },
  });

  for (let i = 0; i < CANDS.length; i++) {
    const c = CANDS[i];
    const r = reservesFor(c.p);
    const market = await db.market.upsert({
      where: { slug: c.slug },
      update: {
        groupId: group.id,
        groupSortOrder: i,
        yesShares: r.yesShares,
        noShares: r.noShares,
        volumeCoins: c.vol,
      },
      create: {
        slug: c.slug,
        title: c.title,
        description: `Will ${c.title} win the 2026 Los Angeles mayoral election?`,
        category: "POLITICS",
        endsAt,
        status: "OPEN",
        yesShares: r.yesShares,
        noShares: r.noShares,
        volumeCoins: c.vol,
        trendingScore: c.vol,
        groupId: group.id,
        groupSortOrder: i,
      },
    });

    // price history
    await db.pricePoint.deleteMany({ where: { marketId: market.id } });
    const now = Date.now();
    await db.pricePoint.createMany({
      data: c.series.map((p, j) => ({
        marketId: market.id,
        yesPrice: p,
        noPrice: 1 - p,
        recordedAt: new Date(now - (c.series.length - j) * 86400000),
      })),
    });

    // a couple of trades for the activity feed
    if (user) {
      await db.trade.createMany({
        data: [
          {
            marketId: market.id,
            userId: user.id,
            outcome: "YES",
            shares: 250,
            cost: Math.round(c.p * 250),
            pricePerShare: c.p,
            yesSharesAfter: r.yesShares,
            noSharesAfter: r.noShares,
          },
        ],
      });
    }
  }

  console.log("Seeded event:", GROUP_SLUG, "with", CANDS.length, "candidates");
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e);
    db.$disconnect();
    process.exit(1);
  });
