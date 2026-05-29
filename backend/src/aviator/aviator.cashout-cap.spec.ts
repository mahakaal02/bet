import { BetSettlementService } from './bet-settlement.service';
import { RoundLifecycleService } from './round-lifecycle.service';
import { AviatorState, ActiveBet } from './aviator-state';
import { timeForMultiplier } from './fairness';

/**
 * Integration-shaped tests for the `cashoutInternal` path with the
 * PR-AVIATOR-PAYOUT-CAP wiring active.
 *
 * Originally these tests reached into AviatorService's private
 * methods. After PR-ARCH-AUDIT Stage B split the god-class, they
 * now construct BetSettlementService and RoundLifecycleService
 * directly with minimal stubs — closer to the production path with
 * no extra mocks, and the same scenarios covered.
 *
 * Coverage:
 *   1. Payout below cap → un-capped path; DB row gets
 *      `cappedByPayoutCap: false`; PLAYER_CASHOUT lacks `capped`.
 *   2. Payout above cap → wallet credited with cap amount;
 *      `originalPayoutCoins` records the uncapped figure;
 *      PLAYER_CASHOUT carries `capped: true`.
 *   3. Cap disabled → behaves exactly like pre-cap legacy code.
 *   4. Idempotency — calling cashoutInternal twice for the same bet
 *      no-ops the second call (manual + auto race).
 *   5. tick() cap-triggered auto-cashout fires at EXACTLY the cap
 *      line, takes precedence over autoCashoutAt.
 */

type MockBet = ActiveBet;

function makeSettlementHarness(opts: {
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
  const gateway = {
    emit: jest.fn((event: string, payload: unknown) => {
      socketEmits.push({ event, payload });
    }),
    getOnlineCount: jest.fn(() => 0),
    attach: jest.fn(),
  };

  const state = new AviatorState();
  state.current = {
    roundId: 'r-1',
    roundNumber: 7,
    seedId: 's-1',
    serverSeed: 'srv',
    serverSeedHash: 'srvhash',
    clientSeed: 'cli',
    nonce: 1,
    crashMultiplier: 1000,
    startedAt: Date.now(),
    engine: null,
    payoutCap: opts.cap,
  };

  const settlement = new BetSettlementService(
    prisma as never,
    betWallet as never,
    state,
    gateway as never,
  );

  return {
    settlement,
    state,
    aviatorBetUpdates,
    walletCredits,
    socketEmits,
    cashoutInternal: settlement.cashoutInternal.bind(settlement),
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

describe('BetSettlementService.cashoutInternal — payout-cap behaviour', () => {
  it('payout BELOW cap: un-capped path, no `capped` field on PLAYER_CASHOUT', async () => {
    const h = makeSettlementHarness({ cap: { enabled: true, maxCoins: 20_000 } });
    const bet = makeBet({ amount: 100 });

    const result = await h.cashoutInternal(bet, 2.5);

    expect(result).toEqual({ multiplier: 2.5, payout: 250, capped: false });
    expect(h.walletCredits).toHaveLength(1);
    expect(h.walletCredits[0]).toMatchObject({
      userId: 'user-1',
      amount: 250,
      kind: 'aviator_cashout',
    });
    expect(h.aviatorBetUpdates[0]).toMatchObject({
      where: { id: 'bet-1' },
      data: {
        payout: 250,
        originalPayoutCoins: 250,
        payoutCapCoins: 20_000,
        cappedByPayoutCap: false,
      },
    });
    const cashoutEvent = h.socketEmits.find(
      (e) => e.event === 'PLAYER_CASHOUT',
    );
    expect(cashoutEvent).toBeDefined();
    expect(cashoutEvent!.payload).not.toHaveProperty('capped');
  });

  it('payout ABOVE cap: clipped wallet credit + capped: true on event', async () => {
    const h = makeSettlementHarness({ cap: { enabled: true, maxCoins: 20_000 } });
    const bet = makeBet({ amount: 100 });

    const result = await h.cashoutInternal(bet, 500);

    expect(result).toEqual({ multiplier: 500, payout: 20_000, capped: true });
    expect(h.walletCredits[0]).toMatchObject({
      amount: 20_000,
      metadata: expect.objectContaining({
        payoutCapped: true,
        originalPayoutCoins: 50_000,
        payoutCapCoins: 20_000,
      }),
    });
    expect(h.aviatorBetUpdates[0]).toMatchObject({
      data: {
        payout: 20_000,
        originalPayoutCoins: 50_000,
        payoutCapCoins: 20_000,
        cappedByPayoutCap: true,
      },
    });
    expect(h.socketEmits.find((e) => e.event === 'PLAYER_CASHOUT')!.payload).toMatchObject({
      capped: true,
      originalPayout: 50_000,
      payoutCapCoins: 20_000,
    });
  });

  it('payout EXACTLY at cap: NOT marked capped (boundary)', async () => {
    const h = makeSettlementHarness({ cap: { enabled: true, maxCoins: 20_000 } });
    const bet = makeBet({ amount: 100 });

    const result = await h.cashoutInternal(bet, 200);

    expect(result).toEqual({ multiplier: 200, payout: 20_000, capped: false });
    expect(h.aviatorBetUpdates[0]).toMatchObject({
      data: { cappedByPayoutCap: false },
    });
  });

  it('cap DISABLED: behaves like legacy (no clip, payoutCapCoins null)', async () => {
    const h = makeSettlementHarness({ cap: { enabled: false, maxCoins: 20_000 } });
    const bet = makeBet({ amount: 100 });

    const result = await h.cashoutInternal(bet, 500);

    expect(result).toEqual({ multiplier: 500, payout: 50_000, capped: false });
    expect(h.walletCredits[0]).toMatchObject({ amount: 50_000 });
    expect(h.aviatorBetUpdates[0]).toMatchObject({
      data: {
        payout: 50_000,
        originalPayoutCoins: 50_000,
        payoutCapCoins: null,
        cappedByPayoutCap: false,
      },
    });
  });

  it('cap DISABLED with non-finite maxCoins: still safe (no clip)', async () => {
    const h = makeSettlementHarness({
      cap: { enabled: false, maxCoins: Number.NaN },
    });
    const bet = makeBet({ amount: 100 });
    const result = await h.cashoutInternal(bet, 1_000);
    expect(result).toEqual({ multiplier: 1_000, payout: 100_000, capped: false });
  });

  it('idempotent: second call no-ops (manual + auto race)', async () => {
    const h = makeSettlementHarness({ cap: { enabled: true, maxCoins: 20_000 } });
    const bet = makeBet({ amount: 100 });

    const first = await h.cashoutInternal(bet, 2.5);
    const second = await h.cashoutInternal(bet, 5.0);

    expect(first).toEqual({ multiplier: 2.5, payout: 250, capped: false });
    expect(second).toBeNull();
    expect(h.walletCredits).toHaveLength(1);
    expect(h.aviatorBetUpdates).toHaveLength(1);
    expect(h.socketEmits.filter((e) => e.event === 'PLAYER_CASHOUT')).toHaveLength(1);
  });

  it('Bet wallet credit failure: DB still records the cashout intent', async () => {
    const h = makeSettlementHarness({
      cap: { enabled: true, maxCoins: 20_000 },
      betWalletThrows: true,
    });
    const bet = makeBet({ amount: 100 });

    const result = await h.cashoutInternal(bet, 500);

    expect(h.aviatorBetUpdates[0]).toMatchObject({
      data: {
        payout: 0,
        originalPayoutCoins: 50_000,
        payoutCapCoins: 20_000,
        cappedByPayoutCap: true,
      },
    });
    expect(result?.capped).toBe(true);

    // Phantom-payout guard (audit fix): a failed credit must NOT enter
    // the persistent winners feed, and the broadcast must mark the
    // cashout pending with a zeroed payout — never the would-be 20k.
    expect(h.state.recentWinners).toHaveLength(0);
    const cashoutEvent = h.socketEmits.find(
      (e) => e.event === 'PLAYER_CASHOUT',
    );
    expect(cashoutEvent).toBeDefined();
    expect(cashoutEvent!.payload).toMatchObject({
      payout: 0,
      settlementPending: true,
    });
  });
});

function makeTickHarness(opts: {
  cap: { enabled: boolean; maxCoins: number };
  bets: MockBet[];
  crashMultiplier: number;
  /** Force the live multiplier `tick()` will compute. */
  currentMultiplier: number;
}) {
  const settlementHarness = makeSettlementHarness({ cap: opts.cap });

  // Populate state.bets — RoundLifecycleService.tick() iterates here.
  for (const b of opts.bets) settlementHarness.state.bets.set(b.userId, b);

  // The real `tick()` recomputes `currentMultiplier` from
  // `multiplierAt(Date.now() - startedAt)`. Compute the `startedAt`
  // that makes the curve sit at the target multiplier RIGHT NOW.
  // This means we exercise the real curve formula instead of stubbing
  // it — closer to the production path with no extra mocks.
  const elapsedMs = timeForMultiplier(opts.currentMultiplier);
  settlementHarness.state.current = {
    ...settlementHarness.state.current!,
    payoutCap: opts.cap,
    crashMultiplier: opts.crashMultiplier,
    startedAt: Date.now() - elapsedMs,
  };
  settlementHarness.state.phase = 'RUNNING';

  // Lifecycle stubs that tick() doesn't reach (no DB, no engine).
  const prisma = {
    aviatorRound: {
      update: jest.fn(async () => ({})),
    },
    aviatorBet: settlementHarness.settlement
      ? // share the prisma mock from settlement so updates land
        // on the same array
        (settlementHarness as unknown as { aviatorBetUpdates: unknown[] })
          .aviatorBetUpdates && undefined
      : undefined,
  };

  const lifecycle = new RoundLifecycleService(
    {
      // Reuse the BetSettlementService's prisma mock so updates from
      // tick → settlement land on the same array. We don't read any
      // round table state in tick (only update on crash, which we
      // avoid by setting crashMultiplier high).
      aviatorBet: {
        update: jest.fn(async (args: unknown) => {
          (settlementHarness.aviatorBetUpdates as unknown[]).push(args);
          return {};
        }),
      },
      aviatorRound: prisma.aviatorRound,
    } as never,
    null as never, // settings — only used in startBettingPhase
    null as never, // fairness — same
    null as never, // crashEngine — same
    settlementHarness.state,
    {
      emit: jest.fn((event: string, payload: unknown) => {
        settlementHarness.socketEmits.push({ event, payload });
      }),
      getOnlineCount: jest.fn(() => 0),
      attach: jest.fn(),
    } as never,
    null as never, // knobs — only used in startBettingPhase
    settlementHarness.settlement,
  );

  return {
    lifecycle,
    state: settlementHarness.state,
    aviatorBetUpdates: settlementHarness.aviatorBetUpdates,
    walletCredits: settlementHarness.walletCredits,
    socketEmits: settlementHarness.socketEmits,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tick: (lifecycle as any).tick.bind(lifecycle),
  };
}

describe('RoundLifecycleService.tick — cap-triggered auto-cashout', () => {
  it('fires at EXACTLY capMultiplier when current crosses the line', async () => {
    const bet = makeBet({ amount: 100, userId: 'u-1' });
    const h = makeTickHarness({
      cap: { enabled: true, maxCoins: 20_000 },
      bets: [bet],
      crashMultiplier: 1_000,
      currentMultiplier: 250,
    });

    await h.tick();

    expect(h.aviatorBetUpdates).toHaveLength(1);
    expect(h.aviatorBetUpdates[0]).toMatchObject({
      data: {
        cashedOutMultiplier: '200.00',
        payout: 20_000,
        cappedByPayoutCap: true,
      },
    });
    expect(
      h.socketEmits.find((e) => e.event === 'PLAYER_CASHOUT')?.payload,
    ).toMatchObject({ multiplier: 200, payout: 20_000, capped: true });
  });

  it('does NOT fire when current multiplier is below the cap line', async () => {
    const bet = makeBet({ amount: 100 });
    const h = makeTickHarness({
      cap: { enabled: true, maxCoins: 20_000 },
      bets: [bet],
      crashMultiplier: 1_000,
      currentMultiplier: 150,
    });

    await h.tick();

    expect(h.aviatorBetUpdates).toHaveLength(0);
    expect(h.walletCredits).toHaveLength(0);
  });

  it('cap-triggered auto-cashout takes precedence over autoCashoutAt', async () => {
    const bet = makeBet({ amount: 100, autoCashoutAt: 500 });
    const h = makeTickHarness({
      cap: { enabled: true, maxCoins: 20_000 },
      bets: [bet],
      crashMultiplier: 1_000,
      currentMultiplier: 250,
    });

    await h.tick();

    expect(h.aviatorBetUpdates).toHaveLength(1);
    expect(h.aviatorBetUpdates[0]).toMatchObject({
      data: { cashedOutMultiplier: '200.00', cappedByPayoutCap: true },
    });
  });

  it('player whose autoCashoutAt < cap line cashes at autoCashoutAt (cap inactive)', async () => {
    const bet = makeBet({ amount: 100, autoCashoutAt: 50 });
    const h = makeTickHarness({
      cap: { enabled: true, maxCoins: 20_000 },
      bets: [bet],
      crashMultiplier: 1_000,
      currentMultiplier: 60,
    });

    await h.tick();

    expect(h.aviatorBetUpdates[0]).toMatchObject({
      data: {
        cashedOutMultiplier: '50.00',
        payout: 5_000,
        cappedByPayoutCap: false,
      },
    });
  });

  it('cap disabled: tick never fires cap-triggered auto-cashout', async () => {
    const bet = makeBet({ amount: 100 });
    const h = makeTickHarness({
      cap: { enabled: false, maxCoins: 20_000 },
      bets: [bet],
      crashMultiplier: 1_000,
      currentMultiplier: 500,
    });

    await h.tick();

    expect(h.aviatorBetUpdates).toHaveLength(0);
  });

  it('multi-bet: cap-triggered settlement is per-bet, independent', async () => {
    const a = makeBet({ betId: 'b-A', userId: 'u-A', amount: 100 });
    const b = makeBet({ betId: 'b-B', userId: 'u-B', amount: 200 });
    const h = makeTickHarness({
      cap: { enabled: true, maxCoins: 20_000 },
      bets: [a, b],
      crashMultiplier: 1_000,
      currentMultiplier: 150,
    });

    await h.tick();

    expect(h.aviatorBetUpdates).toHaveLength(1);
    expect(h.aviatorBetUpdates[0]).toMatchObject({
      where: { id: 'b-B' },
      data: { cashedOutMultiplier: '100.00', payout: 20_000, cappedByPayoutCap: true },
    });
  });
});

describe('BetSettlementService.cashoutInternal — multi-bet independence', () => {
  it("one player's capped cashout does not affect another's payout", async () => {
    const h = makeSettlementHarness({ cap: { enabled: true, maxCoins: 20_000 } });
    const big = makeBet({ betId: 'b-A', userId: 'u-A', amount: 100 });
    const small = makeBet({ betId: 'b-B', userId: 'u-B', amount: 50 });

    const a = await h.cashoutInternal(big, 500);
    expect(a).toEqual({ multiplier: 500, payout: 20_000, capped: true });

    const b = await h.cashoutInternal(small, 2);
    expect(b).toEqual({ multiplier: 2, payout: 100, capped: false });

    expect(
      h.aviatorBetUpdates.map(
        (u) => (u as { data: { payout: number } }).data.payout,
      ),
    ).toEqual([20_000, 100]);
  });
});
