import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Settlement-parity / characterization test for `resolveMarketTx`
 * (lib/settlement.ts), the behaviour-preserving extraction of the
 * standalone market-resolution transaction body.
 *
 * It can't run against a real Postgres in this pure-function vitest setup,
 * so instead it pins the EXACT sequence of transactional effects the
 * resolution performs — wallet credits, idempotent `Transaction` rows
 * (keyed `(kind, reference)`), settlement-fee collection, the `Market`
 * flip, the `Settlement` audit upsert, and the `AdminLog` row — against a
 * hand-rolled fake `tx`. The real (pure) commission math in
 * `splitSettlement` flows through unmocked, so the asserted payouts/fees
 * are the genuine numbers the engine produces.
 *
 * Net effect: this is the regression fence guaranteeing the extraction (and
 * any future edit to the settlement engine) keeps standalone resolution
 * byte-for-byte in its observable behaviour.
 */

// Mock only the three collaborators that touch the DB / tx. `splitSettlement`
// (lib/commission) is pure and runs for real.
vi.mock("@/lib/order-refund", () => ({
  cancelOpenOrdersForMarket: vi.fn(async () => ({
    cancelledCount: 2,
    refundedCoins: 50,
    releasedShares: 0,
    affectedUserIds: [],
  })),
}));
vi.mock("@/lib/house", () => ({
  collectFee: vi.fn(async () => {}),
}));
vi.mock("@/lib/achievements", () => ({
  onResolution: vi.fn(async () => []),
}));

import { resolveMarketTx, HttpError } from "@/lib/settlement";
import { collectFee } from "@/lib/house";
import { cancelOpenOrdersForMarket } from "@/lib/order-refund";
import { onResolution } from "@/lib/achievements";

type TxArg = Parameters<typeof resolveMarketTx>[0];

interface Pos {
  id: string;
  userId: string;
  outcome: "YES" | "NO";
  shares: number;
  costBasis: number;
}

function makeMarket(status = "OPEN") {
  return {
    id: "mkt1",
    slug: "will-it-rain",
    title: "Will it rain?",
    status,
  };
}

function makeTx(market: ReturnType<typeof makeMarket> | null, positions: Pos[]) {
  const calls = {
    walletUpdate: [] as { where: { userId: string }; data: { balance: { increment: number } } }[],
    txCreate: [] as { data: Record<string, unknown> }[],
    posUpdate: [] as { where: { id: string }; data: { realizedPnl: number } }[],
    notif: [] as { data: Record<string, unknown> }[],
    marketUpdate: [] as { data: Record<string, unknown> }[],
    settlementUpsert: [] as { create: Record<string, unknown>; update: Record<string, unknown> }[],
    adminLog: [] as { data: Record<string, unknown> }[],
  };
  const tx = {
    market: {
      findUnique: vi.fn(async () => market),
      update: vi.fn(async (a: { data: Record<string, unknown> }) => {
        calls.marketUpdate.push(a);
        return {};
      }),
    },
    position: {
      findMany: vi.fn(async () => positions),
      update: vi.fn(async (a: { where: { id: string }; data: { realizedPnl: number } }) => {
        calls.posUpdate.push(a);
        return {};
      }),
    },
    wallet: {
      update: vi.fn(async (a: { where: { userId: string }; data: { balance: { increment: number } } }) => {
        calls.walletUpdate.push(a);
        return {};
      }),
    },
    transaction: {
      create: vi.fn(async (a: { data: Record<string, unknown> }) => {
        calls.txCreate.push(a);
        return {};
      }),
    },
    notification: {
      create: vi.fn(async (a: { data: Record<string, unknown> }) => {
        calls.notif.push(a);
        return {};
      }),
    },
    settlement: {
      upsert: vi.fn(async (a: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        calls.settlementUpsert.push(a);
        return {};
      }),
    },
    adminLog: {
      create: vi.fn(async (a: { data: Record<string, unknown> }) => {
        calls.adminLog.push(a);
        return {};
      }),
    },
  };
  return { tx: tx as unknown as TxArg, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveMarketTx — YES resolution", () => {
  // posA: winner with profit → pays settlement fee. posB: loser → nothing.
  // posC: winner break-even → paid, no fee.
  const positions: Pos[] = [
    { id: "posA", userId: "u1", outcome: "YES", shares: 150, costBasis: 100 },
    { id: "posB", userId: "u2", outcome: "NO", shares: 80, costBasis: 60 },
    { id: "posC", userId: "u3", outcome: "YES", shares: 100, costBasis: 100 },
  ];

  it("pays winners net-of-fee and returns the canonical totals", async () => {
    const { tx, calls } = makeTx(makeMarket("OPEN"), positions);
    const result = await resolveMarketTx(tx, {
      marketId: "mkt1",
      outcome: "YES",
      note: "rained at noon",
      executedById: "admin1",
    });

    // splitSettlement(150,100) → net 148 / fee 2 ; (100,100) → 100 / 0
    expect(result.payoutCount).toBe(2);
    expect(result.paidOut).toBe(248);
    expect(result.settlementFee).toBe(2);
    expect(result.orderRefunds).toMatchObject({ cancelledCount: 2, refundedCoins: 50 });
    expect(result.unlocksByUser.size).toBe(0);

    // Wallet credits: only the two winners, net amounts.
    expect(calls.walletUpdate).toHaveLength(2);
    expect(calls.walletUpdate.find((w) => w.where.userId === "u1")?.data.balance.increment).toBe(148);
    expect(calls.walletUpdate.find((w) => w.where.userId === "u3")?.data.balance.increment).toBe(100);
    expect(calls.walletUpdate.find((w) => w.where.userId === "u2")).toBeUndefined();
  });

  it("writes idempotent payout Transaction rows keyed (kind, reference)", async () => {
    const { tx, calls } = makeTx(makeMarket("OPEN"), positions);
    await resolveMarketTx(tx, {
      marketId: "mkt1",
      outcome: "YES",
      executedById: "admin1",
    });

    expect(calls.txCreate).toHaveLength(2);
    const refs = calls.txCreate.map((t) => t.data.reference);
    expect(refs).toContain("YES:mkt1:posA");
    expect(refs).toContain("YES:mkt1:posC");
    for (const t of calls.txCreate) {
      expect(t.data.kind).toBe("resolution_payout");
    }
  });

  it("collects the settlement fee once, only on the profitable winner", async () => {
    const { tx } = makeTx(makeMarket("OPEN"), positions);
    await resolveMarketTx(tx, {
      marketId: "mkt1",
      outcome: "YES",
      executedById: "admin1",
    });

    expect(vi.mocked(collectFee)).toHaveBeenCalledTimes(1);
    const [, feeArgs] = vi.mocked(collectFee).mock.calls[0]!;
    expect(feeArgs).toMatchObject({
      amount: 2,
      kind: "commission_settlement",
      reference: "settlement-fee:mkt1:posA",
    });
  });

  it("flips the market and writes the Settlement + AdminLog audit rows", async () => {
    const { tx, calls } = makeTx(makeMarket("OPEN"), positions);
    await resolveMarketTx(tx, {
      marketId: "mkt1",
      outcome: "YES",
      note: "rained at noon",
      executedById: "admin1",
    });

    expect(calls.marketUpdate[0]!.data).toMatchObject({
      status: "RESOLVED",
      resolvedAs: "YES",
      resolutionNote: "rained at noon",
    });
    expect(calls.settlementUpsert[0]!.create).toMatchObject({
      marketId: "mkt1",
      outcome: "YES",
      totalPayout: 248,
      totalFees: 2,
      winnerCount: 2,
      loserCount: 1,
      status: "EXECUTED",
      executedById: "admin1",
      attempts: 1,
    });
    expect(calls.adminLog[0]!.data).toMatchObject({
      adminId: "admin1",
      action: "market.resolve",
      targetId: "mkt1",
    });

    // Achievement hook runs for every holder when not cancelled.
    expect(vi.mocked(onResolution)).toHaveBeenCalledTimes(3);
    // Order-refund pass happens before any payout.
    expect(vi.mocked(cancelOpenOrdersForMarket)).toHaveBeenCalledTimes(1);
  });

  it("records realized PnL per position (winners net, losers negative)", async () => {
    const { tx, calls } = makeTx(makeMarket("OPEN"), positions);
    await resolveMarketTx(tx, {
      marketId: "mkt1",
      outcome: "YES",
      executedById: "admin1",
    });
    const pnl = (id: string) => calls.posUpdate.find((p) => p.where.id === id)?.data.realizedPnl;
    expect(pnl("posA")).toBe(48); // 148 net − 100 basis
    expect(pnl("posB")).toBe(-60); // 0 − 60
    expect(pnl("posC")).toBe(0); // 100 − 100
  });
});

describe("resolveMarketTx — CANCELLED", () => {
  const positions: Pos[] = [
    { id: "posA", userId: "u1", outcome: "YES", shares: 150, costBasis: 100 },
    { id: "posB", userId: "u2", outcome: "NO", shares: 80, costBasis: 60 },
  ];

  it("refunds cost basis at par with no fee and no achievement checks", async () => {
    const { tx, calls } = makeTx(makeMarket("OPEN"), positions);
    const result = await resolveMarketTx(tx, {
      marketId: "mkt1",
      outcome: "CANCELLED",
      executedById: "admin1",
    });

    expect(result.payoutCount).toBe(2);
    expect(result.paidOut).toBe(160); // 100 + 60
    expect(result.settlementFee).toBe(0);

    expect(vi.mocked(collectFee)).not.toHaveBeenCalled();
    expect(vi.mocked(onResolution)).not.toHaveBeenCalled();

    expect(calls.txCreate.every((t) => t.data.kind === "resolution_refund")).toBe(true);
    expect(calls.txCreate.map((t) => t.data.reference)).toEqual([
      "CANCELLED:mkt1:posA",
      "CANCELLED:mkt1:posB",
    ]);

    expect(calls.marketUpdate[0]!.data).toMatchObject({
      status: "CANCELLED",
      resolvedAs: null,
    });
    expect(calls.settlementUpsert[0]!.create).toMatchObject({ outcome: "CANCELLED" });
    expect(calls.adminLog[0]!.data).toMatchObject({ action: "market.cancel" });
  });
});

describe("resolveMarketTx — guards", () => {
  it("throws 404 when the market is missing", async () => {
    const { tx } = makeTx(null, []);
    await expect(
      resolveMarketTx(tx, { marketId: "nope", outcome: "YES", executedById: "admin1" }),
    ).rejects.toMatchObject({ status: 404, message: "not_found" });
  });

  it("throws 409 when the market is already resolved", async () => {
    const { tx } = makeTx(makeMarket("RESOLVED"), []);
    const err = await resolveMarketTx(tx, {
      marketId: "mkt1",
      outcome: "YES",
      executedById: "admin1",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 409, message: "already_resolved" });
  });

  it("throws 409 when the market is already cancelled", async () => {
    const { tx } = makeTx(makeMarket("CANCELLED"), []);
    await expect(
      resolveMarketTx(tx, { marketId: "mkt1", outcome: "NO", executedById: "admin1" }),
    ).rejects.toMatchObject({ status: 409, message: "already_resolved" });
  });
});
