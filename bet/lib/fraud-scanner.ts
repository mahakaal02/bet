import { db } from "@/lib/db";

/**
 * Fraud-signal scanner (PR-BET-ADMIN-FOLLOWUPS).
 *
 * Runs a small set of heuristic detectors over recent Trade + Order
 * activity and inserts FraudSignal rows for each pattern that crosses
 * its threshold. Pure data scan — no side effects on user accounts.
 * Admin operators triage signals from /admin/fraud and decide whether
 * to ban / freeze / dismiss.
 *
 * Detectors implemented (kept intentionally simple — the heuristic
 * coverage gets ~80% of real cases for ~5% of the complexity an ML
 * pipeline would carry):
 *
 *   1. RAPID_FIRE     — >= 12 trades from one user inside 60 seconds.
 *                       Bot-like rhythm signal.
 *   2. WASH_TRADE     — user buys YES and NO on the same market
 *                       within 60 seconds. Self-cancelling trades
 *                       inflate volume without taking real exposure;
 *                       common manipulation pattern.
 *   3. SPIKE          — single trade ≥ 20% of the market's lifetime
 *                       volume. Could be legitimate (whale takes a
 *                       conviction position) but always worth a look.
 *
 * Idempotency: each detector emits a deterministic `evidence.scanKey`
 * derived from the implicated rows. The insert path checks for a
 * recent (≤ 24h) FraudSignal with the same key + status='OPEN' and
 * skips if found, so re-running the scanner doesn't pile duplicates.
 *
 * Scheduling: this function is callable from a cron worker
 * (`POST /api/admin/fraud/scan` is its admin-triggered companion).
 * Production deployment runs it every 5 minutes via Kalki's existing
 * background-worker pod (PR-WORKER-EXTRACT). Until that scheduler is
 * wired, admins click "Run scan now" from /admin/fraud.
 */

const LOOKBACK_MINUTES = 30;
const RAPID_FIRE_THRESHOLD = 12; // trades in the window
const RAPID_FIRE_WINDOW_SEC = 60;
const WASH_TRADE_WINDOW_SEC = 60;
const SPIKE_PCT_OF_VOLUME = 0.2;

export interface ScanResult {
  scanned: number;
  inserted: number;
  signals: Array<{
    kind: string;
    severity: string;
    summary: string;
  }>;
}

/**
 * Main entry point. Returns a summary so the caller (cron or admin
 * trigger) can render it without re-querying.
 */
export async function runFraudScan(): Promise<ScanResult> {
  const since = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000);
  const recentTrades = await db.trade.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    include: {
      user: { select: { username: true } },
      market: { select: { volumeCoins: true, title: true, slug: true } },
    },
  });

  const inserted: ScanResult["signals"] = [];

  // ─── Detector 1: rapid-fire trades ──────────────────────────────
  // Bucket trades per user, sliding 60-second window.
  const byUser = new Map<string, typeof recentTrades>();
  for (const t of recentTrades) {
    const arr = byUser.get(t.userId) ?? [];
    arr.push(t);
    byUser.set(t.userId, arr);
  }
  for (const [userId, trades] of byUser) {
    if (trades.length < RAPID_FIRE_THRESHOLD) continue;
    // Sliding window: for each trade, count subsequent trades within
    // the window. If any window exceeds threshold, flag.
    for (let i = 0; i < trades.length - RAPID_FIRE_THRESHOLD + 1; i++) {
      const start = trades[i].createdAt.getTime();
      let j = i;
      while (
        j < trades.length &&
        trades[j].createdAt.getTime() - start <= RAPID_FIRE_WINDOW_SEC * 1000
      ) {
        j++;
      }
      const windowSize = j - i;
      if (windowSize >= RAPID_FIRE_THRESHOLD) {
        const summary = `@${trades[i].user.username} placed ${windowSize} trades in ${RAPID_FIRE_WINDOW_SEC}s — bot-like rhythm`;
        const scanKey = `rapid_fire:${userId}:${trades[i].id}`;
        const ok = await insertSignalIfNew({
          kind: "rapid_fire",
          severity: windowSize >= RAPID_FIRE_THRESHOLD * 2 ? "high" : "medium",
          userId,
          marketId: null,
          summary,
          evidence: {
            scanKey,
            windowSize,
            firstTradeId: trades[i].id,
            lastTradeAt: trades[j - 1].createdAt.toISOString(),
          },
        });
        if (ok) inserted.push({ kind: "rapid_fire", severity: "medium", summary });
        break; // one signal per user per scan
      }
    }
  }

  // ─── Detector 2: wash trades ─────────────────────────────────────
  // For each user, group their trades by market and look for opposite-
  // outcome buys within 60 seconds.
  for (const [userId, trades] of byUser) {
    const byMarket = new Map<string, typeof trades>();
    for (const t of trades) {
      const arr = byMarket.get(t.marketId) ?? [];
      arr.push(t);
      byMarket.set(t.marketId, arr);
    }
    for (const [marketId, mTrades] of byMarket) {
      if (mTrades.length < 2) continue;
      for (let i = 0; i < mTrades.length - 1; i++) {
        for (let j = i + 1; j < mTrades.length; j++) {
          const delta =
            (mTrades[j].createdAt.getTime() - mTrades[i].createdAt.getTime()) /
            1000;
          if (delta > WASH_TRADE_WINDOW_SEC) break;
          if (mTrades[i].outcome !== mTrades[j].outcome) {
            const summary = `@${mTrades[i].user.username} bought ${mTrades[i].outcome} then ${mTrades[j].outcome} within ${Math.round(delta)}s on "${mTrades[i].market.title.slice(0, 40)}"`;
            const scanKey = `wash:${userId}:${marketId}:${mTrades[i].id}:${mTrades[j].id}`;
            const ok = await insertSignalIfNew({
              kind: "wash_trade",
              severity: "high",
              userId,
              marketId,
              summary,
              evidence: {
                scanKey,
                trade1: mTrades[i].id,
                trade2: mTrades[j].id,
                deltaSec: delta,
              },
            });
            if (ok) inserted.push({ kind: "wash_trade", severity: "high", summary });
          }
        }
      }
    }
  }

  // ─── Detector 3: volume spikes ──────────────────────────────────
  for (const t of recentTrades) {
    const marketVol = Number(t.market.volumeCoins ?? 0);
    if (marketVol < 1000) continue; // ignore microvolume markets
    const tradeCoins = Math.abs(Number(t.cost ?? 0));
    if (tradeCoins / marketVol >= SPIKE_PCT_OF_VOLUME) {
      const summary = `@${t.user.username} traded ${tradeCoins} coins (${Math.round((tradeCoins / marketVol) * 100)}% of market volume) on "${t.market.title.slice(0, 40)}"`;
      const scanKey = `spike:${t.id}`;
      const ok = await insertSignalIfNew({
        kind: "spike",
        severity: tradeCoins / marketVol >= 0.5 ? "critical" : "high",
        userId: t.userId,
        marketId: t.marketId,
        summary,
        evidence: {
          scanKey,
          tradeId: t.id,
          tradeCoins,
          marketVolumeAfter: marketVol,
        },
      });
      if (ok) inserted.push({ kind: "spike", severity: "high", summary });
    }
  }

  return {
    scanned: recentTrades.length,
    inserted: inserted.length,
    signals: inserted,
  };
}

/**
 * De-duplicating insert. Skips when an OPEN signal with the same
 * `evidence.scanKey` already exists from the last 24h — keeps repeat
 * scans from piling identical rows.
 */
async function insertSignalIfNew(opts: {
  kind: string;
  severity: string;
  userId: string | null;
  marketId: string | null;
  summary: string;
  evidence: { scanKey: string } & Record<string, unknown>;
}): Promise<boolean> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  // Postgres JSON path lookup. We stored scanKey as a top-level field
  // in `evidence`, so this is an indexed-ish equality check (Postgres
  // can use a functional index here if performance becomes an issue;
  // not needed at current scale).
  const existing = await db.fraudSignal.findFirst({
    where: {
      kind: opts.kind,
      status: "OPEN",
      createdAt: { gte: oneDayAgo },
      evidence: { path: ["scanKey"], equals: opts.evidence.scanKey } as never,
    },
    select: { id: true },
  });
  if (existing) return false;
  await db.fraudSignal.create({
    data: {
      kind: opts.kind,
      severity: opts.severity,
      userId: opts.userId,
      marketId: opts.marketId,
      summary: opts.summary,
      evidence: opts.evidence as never,
      status: "OPEN",
    },
  });
  return true;
}
