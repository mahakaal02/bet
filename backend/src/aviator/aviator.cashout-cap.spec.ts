import { AviatorService } from './aviator.service';

/**
 * Integration-shaped tests for the `cashoutInternal` path with the
 * PR-AVIATOR-PAYOUT-CAP wiring active. Rather than spin up the full
 * NestJS module (which would require Postgres + Redis + a real
 * socket server), we construct the service manually with minimal
 * stubs and reach in via a private-method cast. That keeps the test
 * close to the unit-under-test while still exercising the real
 * `applyPayoutCap` → `prisma.update` → `io.emit` chain.
 *
 * Coverage:
 *   1. Payout below cap → un-capped path; DB row gets
 *      `cappedByPayoutCap: false`; PLAYER_CASHOUT lacks `capped` field.
 *   2. Payout above cap → wallet credited with cap amount;
 *      `originalPayoutCoins` records the uncapped figure;
 *      PLAYER_CASHOUT carries `capped: true`.
 *   3. Cap disabled → behaves exactly like pre-cap legacy code;
 *      `originalPayoutCoins` records the payout, `payoutCapCoins`
 *      stays null.
 *   4. Idempotency — calling cashoutInternal twice for the same bet
 *      no-ops the second call (covers manual + auto race).
 */

interface MockBet {
  betId: string;
  userId: string;
  username: string;
  amount: number;
  autoCashoutAt: number | null;
  cashedOutAt: number | null;
}

function makeService(opts: {
  cap: { enabled: boolean; maxCoins: number };
  betWalletThrows?: boolean;
}) {
  const aviatorBetUpdates: unknown[] = [];
  const walletCredits: unknown[] = [];
  const socketEmits: { event: string; payload: unknown }[] = [];

  const prisma = {
    aviatorBet: {
      update: jest.fn(async (args: unknown) => {
        aviatorBetUpdates.push(args);
        return {};
      }),
    },
  };
  const betWallet = {
    credit: jest.fn(async (args: unknown) => {
      walletCredits.push(args);
      if (opts.betWalletThrows) throw new Error('bet wallet offline');
    }),
  };
  const io = {
    emit: jest.fn((event: string, payload: unknown) => {
      socketEmits.push({ event, payload });
    }),
  };

  // We never trigger the constructor's other deps inside cashoutInternal
  // (they're used in unrelated code paths), so passing nulls/casts is safe.
  const service = new AviatorService(
    prisma as never,
    null as never, // httpAdapterHost — only used by attachSocketIo
    null as never, // jwt
    null as never, // fairness
    null as never, // chat
    betWallet as never,
    null as never, // crashEngine
    null as never, // settings — already snapshotted into current.payoutCap
  );
  // Patch private fields the cashout path reaches for.
  (service as unknown as { io: typeof io }).io = io;
  (service as unknown as { recentWinners: unknown[] }).recentWinners = [];
  (service as unknown as { current: unknown }).current = {
    roundId: 'r-1',
    roundNumber: 7,
    payoutCap: opts.cap,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cashoutInternal = (service as any).cashoutInternal.bind(service);

  return {
    service,
    cashoutInternal,
    aviatorBetUpdates,
    walletCredits,
    socketEmits,
  };
}

function makeBet(overrides: Partial<MockBet> = {}): MockBet {
  return {
    betId: 'bet-1',
    userId: 'user-1',
    username: 'tester',
    amount: 100,
    autoCashoutAt: null,
    cashedOutAt: null,
    ...overrides,
  };
}

describe('AviatorService.cashoutInternal — payout-cap behaviour', () => {
  it('payout BELOW cap: un-capped path, no `capped` field on PLAYER_CASHOUT', async () => {
    const harness = makeService({ cap: { enabled: true, maxCoins: 20_000 } });
    const bet = makeBet({ amount: 100 });

    const result = await harness.cashoutInternal(bet, 2.5);

    expect(result).toEqual({ multiplier: 2.5, payout: 250, capped: false });

    // Wallet credited with the raw payout.
    expect(harness.walletCredits).toHaveLength(1);
    expect(harness.walletCredits[0]).toMatchObject({
      userId: 'user-1',
      amount: 250,
      kind: 'aviator_cashout',
    });

    // DB persists the raw payout + records the cap-in-force for audit.
    expect(harness.aviatorBetUpdates).toHaveLength(1);
    expect(harness.aviatorBetUpdates[0]).toMatchObject({
      where: { id: 'bet-1' },
      data: {
        payout: 250,
        originalPayoutCoins: 250,
        payoutCapCoins: 20_000,
        cappedByPayoutCap: false,
      },
    });

    // PLAYER_CASHOUT emitted WITHOUT `capped` (old clients still work).
    const cashoutEvent = harness.socketEmits.find(
      (e) => e.event === 'PLAYER_CASHOUT',
    );
    expect(cashoutEvent).toBeDefined();
    expect(cashoutEvent!.payload).not.toHaveProperty('capped');
  });

  it('payout ABOVE cap: clipped wallet credit + capped: true on event', async () => {
    const harness = makeService({ cap: { enabled: true, maxCoins: 20_000 } });
    // Stake 100, multiplier 500 → uncapped = 50 000. Cap clips to 20 000.
    const bet = makeBet({ amount: 100 });

    const result = await harness.cashoutInternal(bet, 500);

    expect(result).toEqual({ multiplier: 500, payout: 20_000, capped: true });

    // Wallet credited with the CAP amount, not the raw 50k.
    expect(harness.walletCredits[0]).toMatchObject({
      amount: 20_000,
      metadata: expect.objectContaining({
        payoutCapped: true,
        originalPayoutCoins: 50_000,
        payoutCapCoins: 20_000,
      }),
    });

    // DB audit columns set.
    expect(harness.aviatorBetUpdates[0]).toMatchObject({
      data: {
        payout: 20_000,
        originalPayoutCoins: 50_000,
        payoutCapCoins: 20_000,
        cappedByPayoutCap: true,
      },
    });

    // PLAYER_CASHOUT carries the cap flag.
    const cashoutEvent = harness.socketEmits.find(
      (e) => e.event === 'PLAYER_CASHOUT',
    );
    expect(cashoutEvent!.payload).toMatchObject({
      capped: true,
      originalPayout: 50_000,
      payoutCapCoins: 20_000,
    });
  });

  it('payout EXACTLY at cap: NOT marked capped (boundary)', async () => {
    const harness = makeService({ cap: { enabled: true, maxCoins: 20_000 } });
    const bet = makeBet({ amount: 100 });

    const result = await harness.cashoutInternal(bet, 200);

    expect(result).toEqual({ multiplier: 200, payout: 20_000, capped: false });
    expect(harness.aviatorBetUpdates[0]).toMatchObject({
      data: { cappedByPayoutCap: false },
    });
  });

  it('cap DISABLED: behaves like legacy (no clip, payoutCapCoins null)', async () => {
    const harness = makeService({ cap: { enabled: false, maxCoins: 20_000 } });
    const bet = makeBet({ amount: 100 });

    const result = await harness.cashoutInternal(bet, 500);

    expect(result).toEqual({ multiplier: 500, payout: 50_000, capped: false });
    expect(harness.walletCredits[0]).toMatchObject({ amount: 50_000 });
    expect(harness.aviatorBetUpdates[0]).toMatchObject({
      data: {
        payout: 50_000,
        originalPayoutCoins: 50_000,
        payoutCapCoins: null,
        cappedByPayoutCap: false,
      },
    });
  });

  it('cap DISABLED with non-finite maxCoins: still safe (no clip)', async () => {
    const harness = makeService({
      cap: { enabled: false, maxCoins: Number.NaN },
    });
    const bet = makeBet({ amount: 100 });
    const result = await harness.cashoutInternal(bet, 1_000);
    expect(result).toEqual({ multiplier: 1_000, payout: 100_000, capped: false });
  });

  it('idempotent: second call no-ops (manual + auto race)', async () => {
    const harness = makeService({ cap: { enabled: true, maxCoins: 20_000 } });
    const bet = makeBet({ amount: 100 });

    const first = await harness.cashoutInternal(bet, 2.5);
    const second = await harness.cashoutInternal(bet, 5.0);

    expect(first).toEqual({ multiplier: 2.5, payout: 250, capped: false });
    expect(second).toBeNull();
    expect(harness.walletCredits).toHaveLength(1);
    expect(harness.aviatorBetUpdates).toHaveLength(1);
    expect(
      harness.socketEmits.filter((e) => e.event === 'PLAYER_CASHOUT'),
    ).toHaveLength(1);
  });

  it('Bet wallet credit failure: DB still records the cashout intent', async () => {
    const harness = makeService({
      cap: { enabled: true, maxCoins: 20_000 },
      betWalletThrows: true,
    });
    const bet = makeBet({ amount: 100 });

    const result = await harness.cashoutInternal(bet, 500);

    // Bet credit failed → `payout` column stores 0 (existing legacy
    // contract — admin reconciles via the WalletTransaction join).
    // But the cap audit columns STILL reflect what would have been
    // paid, so an operator retrying the credit knows the correct
    // capped amount.
    expect(harness.aviatorBetUpdates[0]).toMatchObject({
      data: {
        payout: 0,
        originalPayoutCoins: 50_000,
        payoutCapCoins: 20_000,
        cappedByPayoutCap: true,
      },
    });
    expect(result?.capped).toBe(true);
  });
});

describe('AviatorService.cashoutInternal — multi-bet independence', () => {
  it("one player's capped cashout does not affect another's payout", async () => {
    // Two players in the same round; cap = 20k.
    const harness = makeService({ cap: { enabled: true, maxCoins: 20_000 } });
    const big = makeBet({ betId: 'b-A', userId: 'u-A', amount: 100 });
    const small = makeBet({ betId: 'b-B', userId: 'u-B', amount: 50 });

    // Player A bets ₹100 and cashes at 500× → would be ₹50 000 → cap to ₹20 000.
    const a = await harness.cashoutInternal(big, 500);
    expect(a).toEqual({ multiplier: 500, payout: 20_000, capped: true });

    // Player B bets ₹50 and cashes at 2× → uncapped ₹100 (well below cap).
    const b = await harness.cashoutInternal(small, 2);
    expect(b).toEqual({ multiplier: 2, payout: 100, capped: false });

    // Each player got an independent settlement.
    expect(harness.aviatorBetUpdates.map((u) => (u as { data: { payout: number } }).data.payout)).toEqual([
      20_000, 100,
    ]);
  });
});
