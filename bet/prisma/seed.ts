import { PrismaClient, MarketCategory } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  // ─── Users ───────────────────────────────────────────────────────────
  //
  // Bet no longer stores credentials — the auctions backend is the
  // single source of truth for user identity (see `lib/auth.ts`). Seed
  // Bet User rows ONLY as wallet anchors keyed to the backend's seeded
  // accounts. Emails match `backend/prisma/seed.ts` exactly so the same
  // login works on all three product surfaces.
  //
  // `passwordHash` is intentionally null on every row — the credentials
  // provider on Bet won't even look at it.
  //
  // Purge legacy @uniquebid.local demo rows so a re-seed produces a
  // clean kalki-only state. (No ringmaster on the bet side, but we keep
  // the NOT clause so the two seeds stay symmetrical.)
  await db.user.deleteMany({
    where: {
      email: { endsWith: "@uniquebid.local" },
      NOT: { email: "ringmaster@uniquebid.local" },
    },
  });

  const admin = await db.user.upsert({
    where: { email: "admin@kalki.local" },
    update: { isAdmin: true },
    create: {
      email: "admin@kalki.local",
      username: "admin",
      isAdmin: true,
      referralCode: "ADMIN1",
      wallet: { create: { balance: 50000 } },
    },
  });

  // Demo traders — mirror backend's user1/2/3 accounts.
  const demos: { id: string }[] = [];
  for (let i = 1; i <= 3; i++) {
    const u = await db.user.upsert({
      where: { email: `user${i}@kalki.local` },
      update: {},
      create: {
        email: `user${i}@kalki.local`,
        username: `user${i}`,
        referralCode: `USER0${i}`,
        xp: Math.floor(Math.random() * 600),
        wallet: { create: { balance: 10000 } },
      },
    });
    demos.push({ id: u.id });
  }

  // Markets across all categories
  const now = Date.now();
  const days = (n: number) => new Date(now + n * 24 * 60 * 60 * 1000);
  const markets: Array<{
    slug: string;
    title: string;
    description: string;
    category: MarketCategory;
    endsAt: Date;
    featured?: boolean;
    bannerUrl?: string;
    resolutionSource?: string;
  }> = [
    {
      slug: "us-prez-2028",
      title: "Will the next US president be a woman?",
      description:
        "Resolves YES if a woman wins the 2028 US presidential election. Resolves NO otherwise. No incumbent assumed.",
      category: "POLITICS",
      featured: true,
      endsAt: days(120),
      resolutionSource: "Associated Press race call",
      bannerUrl: "https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?w=800",
    },
    {
      slug: "btc-100k-q1",
      title: "Will Bitcoin close above $100k by March 31?",
      description:
        "Resolves YES if BTC/USD spot on Coinbase closes ≥ $100,000 on any UTC day before April 1.",
      category: "CRYPTO",
      featured: true,
      endsAt: days(45),
      resolutionSource: "Coinbase daily close",
      bannerUrl: "https://images.unsplash.com/photo-1518546305927-5a555bb7020d?w=800",
    },
    {
      slug: "apple-vision-pro-2-launch",
      title: "Will Apple announce Vision Pro 2 this year?",
      description:
        "YES if Apple publicly announces a successor to Vision Pro (any naming) before December 31.",
      category: "TECH",
      endsAt: days(180),
      resolutionSource: "Apple press release",
      bannerUrl: "https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=800",
    },
    {
      slug: "world-cup-2026-winner-brazil",
      title: "Will Brazil win the 2026 FIFA World Cup?",
      description:
        "Resolves YES if Brazil lifts the trophy at the final on July 19, 2026. NO for any other winner.",
      category: "SPORTS",
      featured: true,
      endsAt: days(60),
      resolutionSource: "FIFA official",
      bannerUrl: "https://images.unsplash.com/photo-1517466787929-bc90951d0974?w=800",
    },
    {
      slug: "oscars-best-picture-2027",
      title: "Will an A24 film win Best Picture at the 2027 Oscars?",
      description:
        "Resolves YES if a film distributed by A24 wins Best Picture.",
      category: "ENTERTAINMENT",
      endsAt: days(90),
      resolutionSource: "AMPAS official ceremony",
      bannerUrl: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800",
    },
    {
      slug: "eth-flip-btc-mcap",
      title: "Will Ethereum overtake Bitcoin in market cap this cycle?",
      description:
        "Resolves YES if ETH market cap > BTC market cap on any UTC day before the end of the year, per CoinGecko.",
      category: "CRYPTO",
      endsAt: days(150),
      resolutionSource: "CoinGecko daily snapshot",
    },
    {
      slug: "openai-ipo-2026",
      title: "Will OpenAI IPO this year?",
      description:
        "Resolves YES if OpenAI files an S-1 with the SEC and begins trading on any US exchange before December 31.",
      category: "TECH",
      endsAt: days(200),
      resolutionSource: "SEC EDGAR + NYSE/NASDAQ listing",
    },
    {
      slug: "nba-finals-mvp-jokic",
      title: "Will Nikola Jokić win NBA Finals MVP this season?",
      description:
        "Resolves YES if Jokić is named Bill Russell NBA Finals Most Valuable Player.",
      category: "SPORTS",
      endsAt: days(70),
      resolutionSource: "NBA Communications",
    },
    {
      slug: "ai-passes-bar",
      title: "Will any AI pass the Uniform Bar Exam at >270 (top decile)?",
      description:
        "Resolves YES if a peer-reviewed paper or NCBE statement confirms an AI scored ≥270 on the UBE this year.",
      category: "TECH",
      endsAt: days(300),
    },
    {
      slug: "midterm-house-flip",
      title: "Will Democrats win the US House majority in the next midterms?",
      description:
        "Resolves YES if Democrats hold ≥218 seats after results are certified.",
      category: "POLITICS",
      endsAt: days(220),
      resolutionSource: "AP House race calls",
    },
    {
      slug: "taylor-swift-album",
      title: "Will Taylor Swift release a new studio album this year?",
      description:
        "Resolves YES if a new original studio album (not a re-recording) drops before December 31.",
      category: "ENTERTAINMENT",
      endsAt: days(110),
    },
  ];

  for (const m of markets) {
    await db.market.upsert({
      where: { slug: m.slug },
      update: {
        title: m.title,
        description: m.description,
        endsAt: m.endsAt,
        featured: m.featured ?? false,
        bannerUrl: m.bannerUrl ?? null,
        resolutionSource: m.resolutionSource ?? null,
      },
      create: {
        slug: m.slug,
        title: m.title,
        description: m.description,
        category: m.category,
        endsAt: m.endsAt,
        featured: m.featured ?? false,
        bannerUrl: m.bannerUrl ?? null,
        resolutionSource: m.resolutionSource ?? null,
        createdById: admin.id,
        trendingScore: Math.random() * 5000,
        volumeCoins: Math.floor(Math.random() * 5000),
        // Slightly perturb starting prices so the seeded UI doesn't read 50/50
        // on every card.
        yesShares: 800 + Math.random() * 400,
        noShares: 800 + Math.random() * 400,
        pricePoints: { create: { yesPrice: 0.5, noPrice: 0.5 } },
      },
    });
  }

  // Achievement catalog. Stable codes are referenced from lib/achievements.ts
  // — adding a new one needs both a row here and a check in the engine.
  const achievements = [
    { code: "first_trade", title: "Open Position", description: "Place your first trade.", icon: "🎯", rewardCoins: 100, rewardXp: 25, sortOrder: 1 },
    { code: "ten_trades", title: "Active Trader", description: "Place 10 trades.", icon: "🔁", rewardCoins: 500, rewardXp: 100, sortOrder: 2 },
    { code: "hundred_trades", title: "Floor Veteran", description: "Place 100 trades.", icon: "🏛️", rewardCoins: 2500, rewardXp: 500, sortOrder: 3 },
    { code: "first_win", title: "First Cashout", description: "Win a market for the first time.", icon: "💰", rewardCoins: 250, rewardXp: 75, sortOrder: 4 },
    { code: "profitable", title: "In The Black", description: "Reach a positive realised P/L across all markets.", icon: "📈", rewardCoins: 500, rewardXp: 100, sortOrder: 5 },
    { code: "streak_7", title: "On a Roll", description: "Claim the daily faucet 7 days in a row.", icon: "🔥", rewardCoins: 1000, rewardXp: 200, sortOrder: 6 },
    { code: "watch_5", title: "Curator", description: "Watch 5 markets.", icon: "⭐", rewardCoins: 100, rewardXp: 25, sortOrder: 7 },
    { code: "referrer", title: "Recruiter", description: "Refer your first user.", icon: "🤝", rewardCoins: 500, rewardXp: 100, sortOrder: 8 },
    { code: "diversified", title: "Diversified", description: "Hold positions in 3 different categories.", icon: "🧬", rewardCoins: 300, rewardXp: 75, sortOrder: 9 },
    { code: "whale", title: "Big Spender", description: "Spend 10,000+ coins in a single trade.", icon: "🐋", rewardCoins: 1000, rewardXp: 200, sortOrder: 10 },
  ];
  for (const a of achievements) {
    await db.achievement.upsert({
      where: { code: a.code },
      update: a,
      create: a,
    });
  }

  console.log(
    `Seeded ${markets.length} markets, ${demos.length} demo Bet shadow users (auth lives on the backend) + admin@kalki.local, ${achievements.length} achievements`,
  );
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
