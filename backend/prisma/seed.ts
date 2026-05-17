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
  const adminPassword = await bcrypt.hash('admin123', 10);
  await prisma.user.upsert({
    where: { email: 'admin@uniquebid.local' },
    update: {},
    create: {
      email: 'admin@uniquebid.local',
      username: 'admin',
      passwordHash: adminPassword,
      emailVerified: true,
      isAdmin: true,
    },
  });

  const demoPassword = await bcrypt.hash('demo1234', 10);
  for (let i = 1; i <= 3; i++) {
    await prisma.user.upsert({
      where: { email: `demo${i}@uniquebid.local` },
      update: {},
      create: {
        email: `demo${i}@uniquebid.local`,
        username: `demo${i}`,
        passwordHash: demoPassword,
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
