/* Demo fixture: seed several Kalshi-style EVENTS (MarketGroups) with their
   child binary markets, price history, trades, and threaded comments posted by
   demo users — so the event-detail redesign renders fully populated locally.

   Idempotent: upserts users/groups/markets by a stable key and rebuilds each
   market's price history, trades and comments on every run. Read-only w.r.t.
   real money — it writes Trade/Comment rows for display only and never runs the
   AMM or settlement.

   Run:  node scripts/seed-grouped-demo.cjs
*/
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

// yesPrice = noShares/(yesShares+noShares). To target YES probability p with
// total liquidity L: noShares = p*L, yesShares = (1-p)*L.
function reservesFor(p, L = 4000) {
  return { yesShares: Math.round((1 - p) * L), noShares: Math.round(p * L) };
}

// Demo commenters (also used as traders). Upserted by email; wallets funded.
const USERS = [
  { username: "satta_samrat", email: "satta_samrat@kalki.local" },
  { username: "punter_raja", email: "punter_raja@kalki.local" },
  { username: "oddsmaker", email: "oddsmaker@kalki.local" },
  { username: "dilliwala", email: "dilliwala@kalki.local" },
  { username: "neutral_nina", email: "neutral_nina@kalki.local" },
  { username: "value_vikram", email: "value_vikram@kalki.local" },
  { username: "footy_fan", email: "footy_fan@kalki.local" },
  { username: "geopolitik", email: "geopolitik@kalki.local" },
  { username: "chai_chartist", email: "chai_chartist@kalki.local" },
  { username: "hedge_hari", email: "hedge_hari@kalki.local" },
];

// Build a gently-trending price series of length n ending near `end`.
function series(end, n = 24, swing = 0.06) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const drift = end - swing * (1 - t); // ramp toward `end`
    const wobble = Math.sin(i * 1.3) * swing * 0.25;
    out.push(Math.min(0.97, Math.max(0.02, drift + wobble)));
  }
  out[out.length - 1] = end;
  return out;
}

const EVENTS = [
  {
    slug: "up-election-2027",
    title: "Who will win the 2027 Uttar Pradesh assembly election?",
    description:
      "Mutually-exclusive market on the next ruling party of Uttar Pradesh. One party resolves YES; all others resolve NO. Resolves to the party that secures a majority (or leads the largest coalition) after the 2027 UP Vidhan Sabha election.",
    category: "POLITICS",
    type: "EXCLUSIVE",
    sortOrder: 1,
    cands: [
      { slug: "up-2027-bjp", title: "Bharatiya Janata Party (BJP)", p: 0.52, vol: 980000 },
      { slug: "up-2027-sp", title: "Samajwadi Party (SP)", p: 0.31, vol: 720000 },
      { slug: "up-2027-bsp", title: "Bahujan Samaj Party (BSP)", p: 0.07, vol: 210000 },
      { slug: "up-2027-inc", title: "Indian National Congress", p: 0.05, vol: 140000 },
      { slug: "up-2027-cjp", title: "Cockroach Janta Party (CJP)", p: 0.03, vol: 88000 },
      { slug: "up-2027-other", title: "Any other party", p: 0.02, vol: 41000 },
    ],
  },
  {
    slug: "fifa-world-cup-2026",
    title: "Who will win the 2026 FIFA World Cup?",
    description:
      "Mutually-exclusive market on the winner of the 2026 FIFA World Cup hosted across the USA, Canada and Mexico. The nation that lifts the trophy resolves YES; every other resolves NO.",
    category: "SPORTS",
    type: "EXCLUSIVE",
    sortOrder: 2,
    cands: [
      { slug: "fifa-2026-argentina", title: "Argentina", p: 0.22, vol: 1320000 },
      { slug: "fifa-2026-france", title: "France", p: 0.2, vol: 1180000 },
      { slug: "fifa-2026-brazil", title: "Brazil", p: 0.18, vol: 1090000 },
      { slug: "fifa-2026-england", title: "England", p: 0.14, vol: 870000 },
      { slug: "fifa-2026-spain", title: "Spain", p: 0.13, vol: 760000 },
      { slug: "fifa-2026-other", title: "Any other nation", p: 0.13, vol: 540000 },
    ],
  },
  {
    slug: "us-iran-2026",
    title: "US–Iran conflict: what happens by end of 2026?",
    description:
      "A shell of independent questions about US–Iran relations through 2026. Each market resolves on its own — these outcomes are NOT mutually exclusive, so prices are shown as raw YES probabilities rather than normalized to 100%.",
    category: "POLITICS",
    type: "INDEPENDENT",
    sortOrder: 3,
    cands: [
      { slug: "us-iran-airstrike-2026", title: "US conducts a direct airstrike on Iranian soil before Jan 1, 2027", p: 0.34, vol: 610000 },
      { slug: "us-iran-ceasefire-2026", title: "A formal US–Iran de-escalation/ceasefire agreement is signed in 2026", p: 0.21, vol: 330000 },
      { slug: "us-iran-hormuz-2026", title: "Strait of Hormuz is closed to shipping for more than 7 consecutive days", p: 0.12, vol: 245000 },
    ],
  },
];

// Comment threads per market. Each top-level comment carries `likes` and an
// optional `replies` array — the Comment model now supports single-level
// threading (parentId) and a likeCount, so the Instagram-style discussion UI
// renders real nested replies with like counts.
function threadsFor(cand) {
  const p = Math.round(cand.p * 100);
  const dec = (cand.p).toFixed(2);
  return [
    {
      by: "value_vikram",
      body: `${dec} feels rich to me — fading this and taking the other side.`,
      likes: 7,
      replies: [
        { by: "punter_raja", body: `Disagree — the trend has been one-way all month. Holding YES.`, likes: 3 },
        { by: "oddsmaker", body: `Fair value is closer to ${(cand.p - 0.02).toFixed(2)} imo.`, likes: 1 },
      ],
    },
    {
      by: "neutral_nina",
      body: `Liquidity is thin here, watch the spread before sizing up.`,
      likes: 4,
      replies: [
        { by: "hedge_hari", body: `Good shout — I split my order into thirds.`, likes: 2 },
      ],
    },
    {
      by: "chai_chartist",
      body: `Chart printed higher lows three weeks running. Momentum says YES.`,
      likes: 5,
      replies: [
        { by: "geopolitik", body: `Momentum cuts both ways near resolution though.`, likes: 1 },
      ],
    },
    { by: "dilliwala", body: `${p}/100 — locking some in at this level.`, likes: 2, replies: [] },
  ];
}

async function main() {
  // ── Demo users + wallets ────────────────────────────────────────────────
  const userByName = {};
  for (const u of USERS) {
    const row = await db.user.upsert({
      where: { email: u.email },
      update: { username: u.username },
      create: {
        email: u.email,
        username: u.username,
        xp: Math.floor(Math.random() * 800),
        wallet: { create: { balance: 25000 } },
      },
    });
    await db.wallet.upsert({
      where: { userId: row.id },
      update: {},
      create: { userId: row.id, balance: 25000 },
    });
    userByName[u.username] = row.id;
  }
  const userIds = Object.values(userByName);

  let marketCount = 0;
  const now = Date.now();
  const endsAt = new Date("2027-03-01T00:00:00Z");

  for (const ev of EVENTS) {
    const group = await db.marketGroup.upsert({
      where: { slug: ev.slug },
      update: {
        title: ev.title,
        description: ev.description,
        category: ev.category,
        type: ev.type,
        status: "OPEN",
        featured: true,
        sortOrder: ev.sortOrder,
      },
      create: {
        slug: ev.slug,
        title: ev.title,
        description: ev.description,
        category: ev.category,
        type: ev.type,
        status: "OPEN",
        featured: true,
        sortOrder: ev.sortOrder,
      },
    });

    for (let i = 0; i < ev.cands.length; i++) {
      const c = ev.cands[i];
      const r = reservesFor(c.p);
      const market = await db.market.upsert({
        where: { slug: c.slug },
        update: {
          title: c.title,
          groupId: group.id,
          groupSortOrder: i,
          yesShares: r.yesShares,
          noShares: r.noShares,
          volumeCoins: c.vol,
          trendingScore: c.vol,
          status: "OPEN",
        },
        create: {
          slug: c.slug,
          title: c.title,
          description: `Will "${c.title}" be the resolved outcome of this event?`,
          category: ev.category,
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
      marketCount++;

      // Price history — rebuild each run.
      await db.pricePoint.deleteMany({ where: { marketId: market.id } });
      const s = series(c.p);
      await db.pricePoint.createMany({
        data: s.map((p, j) => ({
          marketId: market.id,
          yesPrice: p,
          noPrice: 1 - p,
          recordedAt: new Date(now - (s.length - j) * 86400000),
        })),
      });

      // A handful of trades for the activity feed — rebuild each run.
      await db.trade.deleteMany({ where: { marketId: market.id } });
      const tradeRows = [];
      for (let k = 0; k < 5; k++) {
        const uid = userIds[(i + k) % userIds.length];
        const outcome = k % 3 === 0 ? "NO" : "YES";
        const px = outcome === "YES" ? c.p : 1 - c.p;
        const shares = 50 + ((k * 37) % 300);
        tradeRows.push({
          marketId: market.id,
          userId: uid,
          outcome,
          shares,
          cost: Math.round(px * shares),
          pricePerShare: px,
          yesSharesAfter: r.yesShares,
          noSharesAfter: r.noShares,
          createdAt: new Date(now - k * 5400000),
        });
      }
      await db.trade.createMany({ data: tradeRows });

      // Threaded comments — rebuild each run. Only the leading couple of
      // candidates per event get the full thread; tail candidates get one.
      // Each top-level comment is created first (so we have its id), then its
      // replies are created with parentId set — real single-level threading.
      await db.comment.deleteMany({ where: { marketId: market.id } });
      const thread = threadsFor(c);
      const take = i < 2 ? thread.length : 1;
      let order = 0;
      for (const t of thread.slice(0, take)) {
        const parent = await db.comment.create({
          data: {
            marketId: market.id,
            userId: userByName[t.by],
            body: t.body,
            likeCount: t.likes ?? 0,
            createdAt: new Date(now - (take - order) * 3600000),
          },
        });
        order++;
        const replies = t.replies ?? [];
        for (let ri = 0; ri < replies.length; ri++) {
          const rep = replies[ri];
          await db.comment.create({
            data: {
              marketId: market.id,
              userId: userByName[rep.by],
              body: rep.body,
              likeCount: rep.likes ?? 0,
              parentId: parent.id,
              createdAt: new Date(parent.createdAt.getTime() + (ri + 1) * 600000),
            },
          });
        }
      }
    }
  }

  console.log(
    `Seeded ${EVENTS.length} events, ${marketCount} markets, ${USERS.length} demo users, with price history, trades and comments.`,
  );
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e);
    db.$disconnect();
    process.exit(1);
  });
