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

  for (let i = 1; i <= 3; i++) {
    await prisma.user.upsert({
      where: { email: `user${i}@kalki.local` },
      update: { passwordHash: sharedPassword, emailVerified: true },
      create: {
        email: `user${i}@kalki.local`,
        username: `user${i}`,
        passwordHash: sharedPassword,
        emailVerified: true,
      },
    });
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

  const inTwoHours = new Date(Date.now() + 2 * 60 * 60 * 1000);
  await prisma.auction.upsert({
    where: { id: 'seed-sony' },
    update: {},
    create: {
      id: 'seed-sony',
      title: 'Sony WH-1000XM5',
      description: 'Industry-leading noise-cancelling wireless headphones.',
      retailPrice: '29990.00',
      coinsPerBid: 1,
      endsAt: inTwoHours,
    },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
