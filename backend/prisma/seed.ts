import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  await prisma.coinSettings.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default', inrPerCoin: '5.00', defaultCoinsPerBid: 1 },
  });

  // Seed-time coin balances now live on Bet (Kalki Exchange), not in this
  // database. The Bet host hands every new account `SIGNUP_COIN_BONUS` coins
  // on first sign-in. Admin/demo accounts only get credentials here; their
  // wallets materialise on the first call to /api/internal/users/ensure.
  // Purge any pre-existing @uniquebid.local demo accounts so a re-seed
  // produces a clean kalki-only state. The ringmaster sentinel
  // (see src/bids/bids.service.ts) is a system row, not a demo user — skip it.
  await prisma.user.deleteMany({
    where: {
      email: { endsWith: '@uniquebid.local' },
      NOT: { email: 'ringmaster@uniquebid.local' },
    },
  });

  const sharedPassword = await bcrypt.hash('password12345', 10);
  await prisma.user.upsert({
    where: { email: 'admin@kalki.local' },
    update: { passwordHash: sharedPassword, isAdmin: true, emailVerified: true },
    create: {
      email: 'admin@kalki.local',
      username: 'admin',
      passwordHash: sharedPassword,
      emailVerified: true,
      isAdmin: true,
    },
  });

  // Capture the demo-user IDs so we can wire them up as winners on the
  // closed seed auctions below. Re-running the seed is idempotent —
  // emails are the lookup key, IDs stay stable across re-runs.
  const demoUserIds: Record<string, string> = {};
  for (let i = 1; i <= 3; i++) {
    const u = await prisma.user.upsert({
      where: { email: `user${i}@kalki.local` },
      update: { passwordHash: sharedPassword, emailVerified: true },
      create: {
        email: `user${i}@kalki.local`,
        username: `user${i}`,
        passwordHash: sharedPassword,
        emailVerified: true,
      },
    });
    demoUserIds[`user${i}`] = u.id;
  }

  const packs = [
    { id: 'pack-50',  coins: 50,  priceInr: '250.00',  sortOrder: 0 },
    { id: 'pack-120', coins: 120, priceInr: '500.00',  sortOrder: 1 },
    { id: 'pack-300', coins: 300, priceInr: '1100.00', sortOrder: 2 },
  ];
  for (const p of packs) {
    await prisma.coinPack.upsert({
      where: { id: p.id },
      update: {},
      create: { id: p.id, coins: p.coins, priceInr: p.priceInr, sortOrder: p.sortOrder },
    });
  }

  // ─── Auctions ────────────────────────────────────────────────────────
  //
  // A small mix across the three lifecycle states so the auctions
  // catalog has content in all three tabs (Live / Upcoming / Closed)
  // out of the box. Image URLs are intentionally empty arrays —
  // operators upload product photos via the admin surface, the
  // gallery renderer falls back to a 🛒 placeholder until then.
  //
  // Status semantics, per `backend/prisma/schema.prisma`:
  //   UPCOMING — startsAt in the future, scheduler will promote
  //   LIVE     — startsAt in the past (or null), endsAt in the future
  //   ENDED    — finished; winnerId + winnerAmount + closedAt set
  //
  // For ENDED rows we set the winnerId to one of user1/2/3 (whose IDs
  // are stable across re-seeds via the email upsert above) so the
  // closed-tab tiles surface a real username on the winner badge.
  //
  // All retail prices and bid amounts are quoted in coins / INR with
  // the project's standard Decimal(12, 2) precision.

  const now = Date.now();
  const mins = (n: number) => new Date(now + n * 60 * 1000);
  const hours = (n: number) => new Date(now + n * 60 * 60 * 1000);
  const daysFromNow = (n: number) => new Date(now + n * 24 * 60 * 60 * 1000);

  type SeedAuction = {
    id: string;
    title: string;
    description: string;
    retailPrice: string;
    coinsPerBid: number;
    startsAt: Date | null;
    endsAt: Date;
    status: 'UPCOMING' | 'LIVE' | 'ENDED';
    winnerId?: string;
    winnerAmount?: string;
    closedAt?: Date;
  };

  const auctions: SeedAuction[] = [
    // Existing seed-sony — kept so re-running this script doesn't drop
    // it. Promoted to a "Live" entry alongside the others for parity
    // with the new lineup.
    {
      id: 'seed-sony',
      title: 'Sony WH-1000XM5',
      description: 'Industry-leading noise-cancelling wireless headphones. Premium ANC, 30-hour battery, and adaptive sound across calls and music.',
      retailPrice: '29990.00',
      coinsPerBid: 1,
      startsAt: hours(-1),
      endsAt: hours(6),
      status: 'LIVE',
    },

    // ─── LIVE — in the air right now ──────────────────────────────────
    {
      id: 'seed-macbook-air-m4',
      title: 'MacBook Air M4 (13-inch, 256 GB)',
      description: 'Apple silicon M4 chip, 13-inch Liquid Retina display, 18-hour battery, fanless design. Mid-spec configuration in Sky Blue.',
      retailPrice: '114900.00',
      coinsPerBid: 4,
      startsAt: hours(-2),
      endsAt: hours(10),
      status: 'LIVE',
    },
    {
      id: 'seed-dji-mavic-4',
      title: 'DJI Mavic 4 Pro',
      description: 'Flagship triple-camera drone, Hasselblad main sensor, 50-min flight time, 4K/120p slow motion. Standard Fly More combo.',
      retailPrice: '199900.00',
      coinsPerBid: 5,
      startsAt: mins(-30),
      endsAt: hours(14),
      status: 'LIVE',
    },
    {
      id: 'seed-bose-qcue',
      title: 'Bose QuietComfort Ultra Earbuds',
      description: 'Immersive Audio spatial mix, world-class noise cancellation, 6-hour battery in-ear + 24 hours with case.',
      retailPrice: '26990.00',
      coinsPerBid: 2,
      startsAt: mins(-15),
      endsAt: hours(2),
      status: 'LIVE',
    },

    // ─── UPCOMING — scheduler will promote to LIVE on startsAt ────────
    {
      id: 'seed-iphone-16-pro-max',
      title: 'iPhone 16 Pro Max (256 GB)',
      description: 'A18 Pro chip, 6.9-inch Super Retina XDR, titanium frame, 5x telephoto camera. Desert Titanium finish.',
      retailPrice: '144900.00',
      coinsPerBid: 5,
      startsAt: daysFromNow(2),
      endsAt: daysFromNow(4),
      status: 'UPCOMING',
    },
    {
      id: 'seed-ps5-pro',
      title: 'PlayStation 5 Pro (2 TB)',
      description: 'Sony PS5 Pro with custom AMD GPU, 2 TB SSD, ray-tracing acceleration. Includes one DualSense Edge controller.',
      retailPrice: '79990.00',
      coinsPerBid: 3,
      startsAt: daysFromNow(1),
      endsAt: daysFromNow(3),
      status: 'UPCOMING',
    },
    {
      id: 'seed-canon-r5-mk2',
      title: 'Canon EOS R5 Mark II',
      description: '45 MP full-frame mirrorless, 8K30 raw video, in-body image stabilisation. Body only — bring your own RF glass.',
      retailPrice: '349990.00',
      coinsPerBid: 6,
      startsAt: daysFromNow(3),
      endsAt: daysFromNow(6),
      status: 'UPCOMING',
    },

    // ─── ENDED — winnerId + winnerAmount + closedAt set ───────────────
    // The lowest-unique-bid engine sets `winnerAmount` to the actual
    // winning coin amount; we use plausible values that match the
    // engine's Decimal(12, 2) precision and the demo bid-cost economy.
    {
      id: 'seed-apple-watch-ultra-2',
      title: 'Apple Watch Ultra 2',
      description: 'Titanium case, 36-hour battery, dual-frequency GPS, action button. Trail Loop band.',
      retailPrice: '89900.00',
      coinsPerBid: 3,
      startsAt: daysFromNow(-7),
      endsAt: daysFromNow(-5),
      status: 'ENDED',
      winnerId: demoUserIds['user1'],
      winnerAmount: '9.42',
      closedAt: daysFromNow(-5),
    },
    {
      id: 'seed-switch-oled',
      title: 'Nintendo Switch OLED (White)',
      description: 'Vivid 7-inch OLED screen, enhanced audio, 64 GB internal storage. Includes Joy-Con pair + dock.',
      retailPrice: '36990.00',
      coinsPerBid: 2,
      startsAt: daysFromNow(-10),
      endsAt: daysFromNow(-7),
      status: 'ENDED',
      winnerId: demoUserIds['user2'],
      winnerAmount: '13.27',
      closedAt: daysFromNow(-7),
    },
    {
      id: 'seed-royal-enfield-hunter',
      title: 'Royal Enfield Hunter 350',
      description: 'Roadster styling, 349cc air-cooled J-platform engine, dual-channel ABS. Dapper Ash colourway.',
      retailPrice: '175000.00',
      coinsPerBid: 6,
      startsAt: daysFromNow(-14),
      endsAt: daysFromNow(-10),
      status: 'ENDED',
      winnerId: demoUserIds['user3'],
      winnerAmount: '47.51',
      closedAt: daysFromNow(-10),
    },
  ];

  for (const a of auctions) {
    await prisma.auction.upsert({
      where: { id: a.id },
      // On re-seed, keep any operator-uploaded images + bid history
      // intact — only re-assert the descriptive fields and timing.
      update: {
        title: a.title,
        description: a.description,
        retailPrice: a.retailPrice,
        coinsPerBid: a.coinsPerBid,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        status: a.status,
        winnerId: a.winnerId ?? null,
        winnerAmount: a.winnerAmount ?? null,
        closedAt: a.closedAt ?? null,
      },
      create: {
        id: a.id,
        title: a.title,
        description: a.description,
        retailPrice: a.retailPrice,
        coinsPerBid: a.coinsPerBid,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        status: a.status,
        winnerId: a.winnerId,
        winnerAmount: a.winnerAmount,
        closedAt: a.closedAt,
      },
    });
  }

  const liveCount = auctions.filter((a) => a.status === 'LIVE').length;
  const upcomingCount = auctions.filter((a) => a.status === 'UPCOMING').length;
  const endedCount = auctions.filter((a) => a.status === 'ENDED').length;
  console.log(
    `Seeded ${auctions.length} auctions: ${liveCount} live, ${upcomingCount} upcoming, ${endedCount} ended (with winners).`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
