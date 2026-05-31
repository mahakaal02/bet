import { PrismaClient, PricingSnapshotStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import Decimal from 'decimal.js';

// ─── Pricing bootstrap helpers (inlined from src/pricing/) ──────────────
// Mirrors src/pricing/pricing.config.ts + regional-rounding.ts. Inlined
// rather than imported because the runner image ships dist/ but not
// src/, and importing from '../dist/src/pricing/*' fails at tsc time
// (dist/ doesn't exist yet during `nest build`) while importing from
// '../src/pricing/*' fails at runtime under Node 20's require/ESM
// interplay (the extensionless require falls through to the ESM
// resolver and errors with ERR_MODULE_NOT_FOUND before ts-node's `.ts`
// hook fires). The src files remain the authoritative copy used by the
// live backend; this duplication is intentionally tiny (one rounding
// helper, a 16-row catalog) and only feeds the offline bootstrap which
// the first annual pricing sync overwrites wholesale.
type RoundingStrategy =
  | 'charm_99_minor'
  | 'charm_9_whole'
  | 'nearest_10_whole'
  | 'nearest_100_whole'
  | 'nearest_500_whole';
interface CountryConfig {
  country: string;
  currency: string;
  fractionDigits: number;
  rounding: RoundingStrategy;
  name: string;
}
const BASELINE_COUNTRY = 'US';
const COUNTRY_CATALOG: readonly CountryConfig[] = [
  { country: 'US', currency: 'USD', fractionDigits: 2, rounding: 'charm_99_minor', name: 'United States' },
  { country: 'IN', currency: 'INR', fractionDigits: 0, rounding: 'charm_9_whole', name: 'India' },
  { country: 'BR', currency: 'BRL', fractionDigits: 2, rounding: 'charm_99_minor', name: 'Brazil' },
  { country: 'TR', currency: 'TRY', fractionDigits: 0, rounding: 'charm_9_whole', name: 'Türkiye' },
  { country: 'JP', currency: 'JPY', fractionDigits: 0, rounding: 'nearest_10_whole', name: 'Japan' },
  { country: 'ID', currency: 'IDR', fractionDigits: 0, rounding: 'nearest_500_whole', name: 'Indonesia' },
  { country: 'NG', currency: 'NGN', fractionDigits: 0, rounding: 'charm_9_whole', name: 'Nigeria' },
  { country: 'PH', currency: 'PHP', fractionDigits: 0, rounding: 'charm_9_whole', name: 'Philippines' },
  { country: 'MX', currency: 'MXN', fractionDigits: 2, rounding: 'charm_99_minor', name: 'Mexico' },
  { country: 'FR', currency: 'EUR', fractionDigits: 2, rounding: 'charm_99_minor', name: 'France' },
  { country: 'AE', currency: 'AED', fractionDigits: 2, rounding: 'charm_99_minor', name: 'United Arab Emirates' },
  { country: 'CN', currency: 'CNY', fractionDigits: 0, rounding: 'charm_9_whole', name: 'China' },
  { country: 'CH', currency: 'CHF', fractionDigits: 2, rounding: 'charm_99_minor', name: 'Switzerland' },
  { country: 'GB', currency: 'GBP', fractionDigits: 2, rounding: 'charm_99_minor', name: 'United Kingdom' },
  { country: 'RU', currency: 'RUB', fractionDigits: 0, rounding: 'charm_9_whole', name: 'Russia' },
  { country: 'ZA', currency: 'ZAR', fractionDigits: 0, rounding: 'charm_9_whole', name: 'South Africa' },
];
const COUNTRY_BY_CODE: ReadonlyMap<string, CountryConfig> = new Map(
  COUNTRY_CATALOG.map((c) => [c.country, c]),
);
function charm99Minor(value: Decimal): Decimal {
  const floor = value.floor();
  const candidate = floor.plus('0.99');
  if (value.lessThanOrEqualTo(candidate)) return candidate;
  return floor.plus(1).plus('0.99');
}
function charm9Whole(value: Decimal): Decimal {
  const v = value.ceil();
  let step: Decimal;
  if (v.lessThan(100)) step = new Decimal(10);
  else if (v.lessThan(1000)) step = new Decimal(10);
  else if (v.lessThan(10000)) step = new Decimal(100);
  else step = new Decimal(1000);
  const mult = v.dividedBy(step).ceil().times(step);
  const charm = mult.minus(1);
  return charm.greaterThanOrEqualTo(v) ? charm : charm.plus(step);
}
function nearestWhole(value: Decimal, n: number): Decimal {
  const step = new Decimal(n);
  return value.dividedBy(step).ceil().times(step);
}
const STRATEGIES: Record<RoundingStrategy, (v: Decimal) => Decimal> = {
  charm_99_minor: charm99Minor,
  charm_9_whole: charm9Whole,
  nearest_10_whole: (v) => nearestWhole(v, 10),
  nearest_100_whole: (v) => nearestWhole(v, 100),
  nearest_500_whole: (v) => nearestWhole(v, 500),
};
function roundPriceForRegion(country: string, value: Decimal.Value): Decimal {
  const cfg = COUNTRY_BY_CODE.get(country.toUpperCase());
  const v = new Decimal(value);
  if (v.lessThanOrEqualTo(0)) return new Decimal(0);
  if (!cfg) return v.toDecimalPlaces(2, Decimal.ROUND_UP);
  const rounded = STRATEGIES[cfg.rounding](v);
  return rounded.toDecimalPlaces(cfg.fractionDigits, Decimal.ROUND_HALF_UP);
}
// ────────────────────────────────────────────────────────────────────────

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

  // `baseUsdPrice` is the canonical USD anchor the PPP pricing system
  // derives every regional price from (see backend/PRICING.md). `sku`
  // maps to the Apple/Google store product id. `priceInr` stays as the
  // legacy India INR price (the sync also produces an IN row that
  // ops can compare against it).
  // Aligned to the bet (Kalki Exchange) wallet tiers (100/500/1000/
  // 5000) so the PPP system produces a localized price for the exact
  // packs the wallet sells. `priceInr` stays at the legacy 1:1 value
  // (legacy INR path); the localized fiat price the user sees
  // comes from RegionalCoinPricing.
  const packs = [
    { id: 'pack-100',  coins: 100,  priceInr: '100.00',  baseUsdPrice: '0.99',  sku: 'coins_100',  sortOrder: 0 },
    { id: 'pack-500',  coins: 500,  priceInr: '500.00',  baseUsdPrice: '3.99',  sku: 'coins_500',  sortOrder: 1 },
    { id: 'pack-1000', coins: 1000, priceInr: '1000.00', baseUsdPrice: '6.99',  sku: 'coins_1000', sortOrder: 2 },
    { id: 'pack-5000', coins: 5000, priceInr: '5000.00', baseUsdPrice: '29.99', sku: 'coins_5000', sortOrder: 3 },
  ];
  for (const p of packs) {
    await prisma.coinPack.upsert({
      where: { id: p.id },
      update: { baseUsdPrice: p.baseUsdPrice, sku: p.sku, coins: p.coins, priceInr: p.priceInr, sortOrder: p.sortOrder },
      create: {
        id: p.id,
        coins: p.coins,
        priceInr: p.priceInr,
        baseUsdPrice: p.baseUsdPrice,
        sku: p.sku,
        sortOrder: p.sortOrder,
      },
    });
  }
  // Retire the pre-alignment pack tiers so the PPP sync (which only
  // prices `active: true` packs) and the wallet stop surfacing them.
  await prisma.coinPack.updateMany({
    where: { id: { in: ['pack-50', 'pack-120', 'pack-300'] } },
    data: { active: false },
  });

  // Bootstrap an active PPP pricing snapshot so a fresh DB serves
  // localized prices (and the admin pricing/coin-pack screens show
  // PPP) WITHOUT first needing a successful annual sync against the
  // external forex/World-Bank APIs.
  await bootstrapPricing();

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

/**
 * Static, offline bootstrap values for the PPP pricing snapshot.
 * These are intentionally APPROXIMATE — illustrative affordability
 * multipliers (already normalized vs the US baseline of 1.0 and within
 * the engine's [0.25, 1.25] clamp band) and rough USD→currency rates.
 * They exist only so a fresh database has working localized pricing
 * before the real annual sync runs; the first `runAnnualPricingSync`
 * for this year REPLACES this snapshot wholesale with live data.
 */
const BOOTSTRAP_PPP_MULTIPLIER: Readonly<Record<string, number>> = {
  US: 1.0, IN: 0.25, BR: 0.4, TR: 0.45, JP: 0.65, ID: 0.3,
  NG: 0.25, PH: 0.3, MX: 0.45, FR: 0.8, AE: 0.95, CN: 0.45,
  CH: 1.05, GB: 0.8, RU: 0.45, ZA: 0.35,
};
/** 1 USD = N units of the currency. Approximate, early-2026 vintage. */
const BOOTSTRAP_USD_RATE: Readonly<Record<string, number>> = {
  USD: 1, INR: 86, BRL: 5.7, TRY: 39, JPY: 156, IDR: 16300,
  NGN: 1550, PHP: 58, MXN: 20, EUR: 0.95, AED: 3.67, CNY: 7.2,
  CHF: 0.9, GBP: 0.79, RUB: 92, ZAR: 18.5,
};

async function bootstrapPricing(): Promise<void> {
  const year = new Date().getUTCFullYear();

  // Idempotent + non-destructive: skip if a real (or prior bootstrap)
  // snapshot already covers this year, or if ANY published snapshot is
  // already active — never clobber live pricing on a re-seed.
  const [sameYear, activePublished] = await Promise.all([
    prisma.pricingSnapshot.findUnique({ where: { effectiveYear: year } }),
    prisma.pricingSnapshot.findFirst({
      where: { isActive: true, status: PricingSnapshotStatus.PUBLISHED },
    }),
  ]);
  if (sameYear || activePublished) {
    console.log(
      `Pricing: snapshot already present (year=${sameYear?.effectiveYear ?? '-'}, ` +
        `active=${activePublished?.effectiveYear ?? '-'}) — skipping bootstrap.`,
    );
    return;
  }

  const packs = await prisma.coinPack.findMany({
    where: { active: true, baseUsdPrice: { not: null } },
    orderBy: [{ sortOrder: 'asc' }, { coins: 'asc' }],
  });
  if (packs.length === 0) {
    console.log('Pricing: no active packs with a baseUsdPrice — skipping bootstrap.');
    return;
  }

  // Fail loudly if the catalog grew without bootstrap data for the new
  // market, rather than silently mispricing it.
  for (const cfg of COUNTRY_CATALOG) {
    if (BOOTSTRAP_PPP_MULTIPLIER[cfg.country] === undefined) {
      throw new Error(`bootstrapPricing: missing PPP multiplier for ${cfg.country}`);
    }
    if (BOOTSTRAP_USD_RATE[cfg.currency] === undefined) {
      throw new Error(`bootstrapPricing: missing USD rate for ${cfg.currency}`);
    }
  }

  const SOURCE = 'bootstrap-seed (static)';
  await prisma.$transaction(async (tx) => {
    const snapshot = await tx.pricingSnapshot.create({
      data: {
        effectiveYear: year,
        status: PricingSnapshotStatus.PUBLISHED,
        isActive: true,
        baselineCountry: BASELINE_COUNTRY,
        forexSource: SOURCE,
        pppSource: SOURCE,
        notes: 'Seed bootstrap — replaced by the first annual pricing sync.',
      },
    });

    // De-duplicate currencies (e.g. EUR shared across markets).
    const currencies = Array.from(new Set(COUNTRY_CATALOG.map((c) => c.currency)));
    await tx.forexRateSnapshot.createMany({
      data: currencies.map((currencyCode) => ({
        snapshotId: snapshot.id,
        effectiveYear: year,
        currencyCode,
        usdRate: new Decimal(BOOTSTRAP_USD_RATE[currencyCode]).toFixed(6),
        source: SOURCE,
      })),
    });
    await tx.pppFactorSnapshot.createMany({
      data: COUNTRY_CATALOG.map((cfg) => ({
        snapshotId: snapshot.id,
        effectiveYear: year,
        countryCode: cfg.country,
        rawPppValue: null,
        normalizedMultiplier: new Decimal(BOOTSTRAP_PPP_MULTIPLIER[cfg.country]).toFixed(4),
        source: SOURCE,
        isFallback: false,
      })),
    });

    const rows = [];
    for (const pack of packs) {
      const baseUsd = new Decimal(pack.baseUsdPrice!.toString());
      for (const cfg of COUNTRY_CATALOG) {
        const mult = new Decimal(BOOTSTRAP_PPP_MULTIPLIER[cfg.country]);
        const rate = new Decimal(BOOTSTRAP_USD_RATE[cfg.currency]);
        // local = base_usd × ppp_multiplier × usd_rate, then charm-round.
        const calculated = baseUsd.times(mult).times(rate);
        const rounded = roundPriceForRegion(cfg.country, calculated);
        rows.push({
          snapshotId: snapshot.id,
          coinPackId: pack.id,
          countryCode: cfg.country,
          currencyCode: cfg.currency,
          baseUsdPrice: baseUsd.toFixed(2),
          forexRate: rate.toFixed(6),
          pppMultiplier: mult.toFixed(4),
          calculatedLocalPrice: calculated.toFixed(4),
          roundedFinalPrice: rounded.toFixed(cfg.fractionDigits),
          effectiveYear: year,
          sourceExchangeRate: SOURCE,
          sourcePppData: SOURCE,
          isActive: true,
        });
      }
    }
    await tx.regionalCoinPricing.createMany({ data: rows });

    console.log(
      `Pricing: bootstrapped snapshot ${year} — ${rows.length} rows ` +
        `(${packs.length} packs × ${COUNTRY_CATALOG.length} countries), published + active.`,
    );
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
