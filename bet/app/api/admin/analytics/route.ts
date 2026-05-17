import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Admin dashboard analytics. Returns three blocks:
 *
 *  • `series`   — daily time-series for the chart: volume, trades, signups,
 *                 platform revenue (commission_* sum from Transaction).
 *  • `summary`  — header chips: active markets, open orders, total coins in
 *                 circulation, ACTIVE USERS in the window (DAU-style),
 *                 platform revenue totals, open interest (sum of all
 *                 outstanding position shares × current marginal price).
 *  • `topMarkets` — top 5 markets by volume in the window, with title +
 *                   coin volume for the leaderboard tile.
 *
 * Window is `?days=` (default 14, max 90). All aggregates filter on
 * `createdAt >= since` so the window controls everything except the
 * "current state" counters (open orders, active markets, coins held,
 * open interest, lifetime platform revenue).
 */
export async function GET(req: Request) {
  const me = await getAuthedUser();
  if (!me?.isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const daysParam = Number(url.searchParams.get("days"));
  const days = Math.min(
    90,
    Math.max(7, Number.isFinite(daysParam) ? daysParam : 14),
  );
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // ─── Daily series ────────────────────────────────────────────────────────
  //
  // ABS(cost) on Trade so AMM sells (stored with negative cost to mark a
  // coin inflow to the user) still count as volume. fee-coin column is
  // already an unsigned per-fill snapshot, so SUM works directly.
  const volumeRows: { day: Date; volume: number; trades: number; fees: number }[] =
    await db.$queryRaw`
      SELECT
        date_trunc('day', "createdAt") AT TIME ZONE 'UTC' AS day,
        SUM(ABS("cost"))::int       AS volume,
        COUNT(*)::int               AS trades,
        SUM("feeCoins")::int        AS fees
      FROM "Trade"
      WHERE "createdAt" >= ${since}
      GROUP BY day
      ORDER BY day ASC
    `;

  const signupRows: { day: Date; signups: number }[] = await db.$queryRaw`
    SELECT
      date_trunc('day', "createdAt") AT TIME ZONE 'UTC' AS day,
      COUNT(*)::int AS signups
    FROM "User"
    WHERE "createdAt" >= ${since}
    GROUP BY day
    ORDER BY day ASC
  `;

  // Daily platform revenue — includes settlement fees that don't ride on
  // a Trade row. The (kind LIKE 'commission_%') predicate matches all
  // three buckets (buy / sell / settlement). Lives separately from the
  // per-Trade fee column above so SETTLEMENT days light up on the chart
  // even if no trading happened.
  const revenueRows: { day: Date; revenue: number }[] = await db.$queryRaw`
    SELECT
      date_trunc('day', "createdAt") AT TIME ZONE 'UTC' AS day,
      SUM("delta")::int AS revenue
    FROM "Transaction"
    WHERE "createdAt" >= ${since}
      AND "kind" LIKE 'commission_%'
    GROUP BY day
    ORDER BY day ASC
  `;

  // Merge all four series into one bucket per day. Dense fill so the
  // chart line doesn't disappear on quiet days.
  const buckets = new Map<
    string,
    { day: string; volume: number; trades: number; signups: number; revenue: number }
  >();
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    const d = new Date(todayUtc);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, { day: key, volume: 0, trades: 0, signups: 0, revenue: 0 });
  }
  for (const r of volumeRows) {
    const key = new Date(r.day).toISOString().slice(0, 10);
    const b = buckets.get(key);
    if (b) {
      b.volume = Number(r.volume);
      b.trades = Number(r.trades);
    }
  }
  for (const r of signupRows) {
    const key = new Date(r.day).toISOString().slice(0, 10);
    const b = buckets.get(key);
    if (b) b.signups = Number(r.signups);
  }
  for (const r of revenueRows) {
    const key = new Date(r.day).toISOString().slice(0, 10);
    const b = buckets.get(key);
    if (b) b.revenue = Number(r.revenue);
  }
  const series = [...buckets.values()].sort((a, b) => a.day.localeCompare(b.day));

  // ─── Summary chips ───────────────────────────────────────────────────────
  const [
    activeMarkets,
    openTrades,
    totalCoinsHeld,
    revenue,
    activeUsersRows,
    openInterestRows,
  ] = await db.$transaction([
    db.market.count({ where: { status: "OPEN" } }),
    db.order.count({ where: { status: { in: ["OPEN", "PARTIAL"] } } }),
    db.wallet.aggregate({ _sum: { balance: true } }),
    // PlatformRevenue is a singleton with cached counters maintained
    // inside every fee-collecting transaction (see lib/house.ts).
    db.platformRevenue.findUnique({ where: { id: "singleton" } }),
    // DAU-style: distinct users who placed a trade in the window. Using
    // Trade rather than Transaction so signup-bonus rows don't count.
    db.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT "userId")::bigint AS count
      FROM "Trade"
      WHERE "createdAt" >= ${since}
    `,
    // Open interest = Σ (position.shares × current marginal price of that
    // outcome) across all OPEN markets. Marginal YES price = no/(yes+no);
    // marginal NO price = yes/(yes+no). One CTE join, costs O(positions).
    db.$queryRaw<{ openInterest: number }[]>`
      SELECT COALESCE(SUM(
        CASE
          WHEN p.outcome = 'YES'::"Outcome"
            THEN p.shares * (m."noShares"  / NULLIF(m."yesShares" + m."noShares", 0))
          ELSE          p.shares * (m."yesShares" / NULLIF(m."yesShares" + m."noShares", 0))
        END
      ), 0)::float AS "openInterest"
      FROM "Position" p
      JOIN "Market" m ON m.id = p."marketId"
      WHERE p.shares > 0 AND m.status = 'OPEN'
    `,
  ]);

  // ─── Top markets by volume in the window ────────────────────────────────
  const topMarkets = await db.$queryRaw<
    {
      id: string;
      slug: string;
      title: string;
      volume: number;
      trades: number;
      status: string;
    }[]
  >`
    SELECT
      m.id, m.slug, m.title, m.status::text AS status,
      SUM(ABS(t.cost))::int AS volume,
      COUNT(t.id)::int      AS trades
    FROM "Trade" t
    JOIN "Market" m ON m.id = t."marketId"
    WHERE t."createdAt" >= ${since}
    GROUP BY m.id, m.slug, m.title, m.status
    ORDER BY volume DESC
    LIMIT 5
  `;

  return NextResponse.json({
    series,
    summary: {
      activeMarkets,
      openOrders: openTrades,
      totalCoinsHeld: totalCoinsHeld._sum.balance ?? 0,
      activeUsers: Number(activeUsersRows?.[0]?.count ?? 0),
      openInterest: Math.round(Number(openInterestRows?.[0]?.openInterest ?? 0)),
      // Lifetime totals — not windowed; they cover the whole platform
      // history. The daily `series.revenue` is the windowed counterpart.
      totalTradingFees: revenue?.totalTradingFees ?? 0,
      totalSettlementFees: revenue?.totalSettlementFees ?? 0,
      totalPlatformRevenue: revenue?.totalPlatformRevenue ?? 0,
      windowDays: days,
    },
    topMarkets: topMarkets.map((m) => ({
      id: m.id,
      slug: m.slug,
      title: m.title,
      status: m.status,
      volume: Number(m.volume),
      trades: Number(m.trades),
    })),
  });
}
