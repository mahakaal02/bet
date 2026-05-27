import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

/**
 * Service-level tests for PaymentsService (PR-ARCH-AUDIT, Stage G).
 *
 * Razorpay's idempotency contract is the most security-sensitive
 * part of the wallet topup flow — these tests pin down:
 *
 *   1. Invalid signature → 400 (must reject before any DB read).
 *   2. Replay of the same paymentId → returns cached result, NOT a
 *      second Bet credit.
 *   3. Order mismatch (wrong user) → 400.
 *   4. Wallet-topup verify on a coin-pack order → 400.
 *   5. Bet credit + audit row + PaymentOrder.update all in one txn.
 */

function makePrisma(initial: {
  paymentOrder?: Record<string, unknown> | null;
  coinTransaction?: Record<string, unknown> | null;
} = {}) {
  let order = initial.paymentOrder ?? null;
  let existing = initial.coinTransaction ?? null;
  const txCoinTxCreate = jest.fn(async (args: { data: Record<string, unknown> }) => {
    existing = args.data;
    return existing;
  });
  const txPaymentOrderUpdate = jest.fn(async (args: { data: Record<string, unknown> }) => {
    order = { ...(order as Record<string, unknown>), ...args.data };
    return order;
  });
  return {
    paymentOrder: {
      findUnique: jest.fn(async () => order),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        order = { ...args.data };
        return order;
      }),
    },
    coinTransaction: {
      findFirst: jest.fn(async () => existing),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        coinTransaction: { create: txCoinTxCreate },
        paymentOrder: { update: txPaymentOrderUpdate },
      }),
    ),
    _state: () => ({ order, existing }),
    _calls: () => ({ txCoinTxCreate, txPaymentOrderUpdate }),
  };
}

function makeService(opts: {
  signatureValid?: boolean;
  betCredit?: { balance: number; duplicate: boolean };
  betCreditThrows?: boolean;
  prisma: ReturnType<typeof makePrisma>;
}) {
  const razorpay = {
    verifyPaymentSignature: jest.fn(() => opts.signatureValid ?? true),
    publicKeyId: jest.fn(() => 'rzp_test_key'),
    createOrder: jest.fn(async () => ({ id: 'order-fresh' })),
  };
  const betWallet = {
    credit: jest.fn(async () => {
      if (opts.betCreditThrows) throw new Error('bet down');
      return opts.betCredit ?? { balance: 1000, duplicate: false };
    }),
    balance: jest.fn(async () => 1000),
  };
  const packs = {
    getOrThrow: jest.fn(async () => ({
      id: 'pack-1',
      active: true,
      priceInr: { toString: () => '99.00' },
      coins: 100,
    })),
  };
  const svc = new PaymentsService(
    opts.prisma as never,
    packs as never,
    razorpay as never,
    betWallet as never,
  );
  return { svc, razorpay, betWallet, packs };
}

describe('PaymentsService.verifyAndCredit (coin-pack flow)', () => {
  it('rejects invalid signatures before reading the DB', async () => {
    const prisma = makePrisma();
    const { svc } = makeService({ signatureValid: false, prisma });
    await expect(
      svc.verifyAndCredit('u-1', 'order-1', 'pay-1', 'bad-sig'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.paymentOrder.findUnique).not.toHaveBeenCalled();
  });

  it('404s when the order is not found', async () => {
    const prisma = makePrisma({ paymentOrder: null });
    const { svc } = makeService({ signatureValid: true, prisma });
    await expect(
      svc.verifyAndCredit('u-1', 'order-1', 'pay-1', 'sig'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an order belonging to a different user', async () => {
    const prisma = makePrisma({
      paymentOrder: {
        razorpayOrderId: 'order-1',
        userId: 'someone-else',
        coinPackId: 'pack-1',
        coins: 100,
        kind: 'COIN_PACK',
      },
    });
    const { svc } = makeService({ signatureValid: true, prisma });
    await expect(
      svc.verifyAndCredit('u-1', 'order-1', 'pay-1', 'sig'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('replay of the same paymentId returns cached result without re-crediting', async () => {
    const prisma = makePrisma({
      paymentOrder: {
        razorpayOrderId: 'order-1',
        userId: 'u-1',
        coinPackId: 'pack-1',
        coins: 100,
        kind: 'COIN_PACK',
      },
      coinTransaction: {
        userId: 'u-1',
        delta: 100,
        reason: 'razorpay_purchase',
        reference: 'pay-1',
      },
    });
    const { svc, betWallet } = makeService({ signatureValid: true, prisma });
    const result = await svc.verifyAndCredit('u-1', 'order-1', 'pay-1', 'sig');
    expect(result.creditedCoins).toBe(100);
    expect(betWallet.credit).not.toHaveBeenCalled();
  });

  it('happy path: signature ok, no replay, credits Bet + writes audit row + updates order', async () => {
    const prisma = makePrisma({
      paymentOrder: {
        razorpayOrderId: 'order-1',
        userId: 'u-1',
        coinPackId: 'pack-1',
        coins: 100,
        kind: 'COIN_PACK',
      },
    });
    const { svc, betWallet } = makeService({
      signatureValid: true,
      betCredit: { balance: 1100, duplicate: false },
      prisma,
    });
    const result = await svc.verifyAndCredit('u-1', 'order-1', 'pay-1', 'sig');
    expect(result).toEqual({ creditedCoins: 100, newBalance: 1100 });
    expect(betWallet.credit).toHaveBeenCalledTimes(1);
    expect((betWallet.credit as jest.Mock).mock.calls[0][0]).toMatchObject({
      userId: 'u-1',
      amount: 100,
      kind: 'wallet_topup',
      reference: 'razorpay:pay-1',
    });
    // Audit row + order update both ran inside the transaction.
    const calls = prisma._calls();
    expect(calls.txCoinTxCreate).toHaveBeenCalledTimes(1);
    expect(calls.txPaymentOrderUpdate).toHaveBeenCalledTimes(1);
  });

  it('audit-row race (P2002) → 409 Conflict (wallet credit already happened)', async () => {
    const prisma = makePrisma({
      paymentOrder: {
        razorpayOrderId: 'order-1',
        userId: 'u-1',
        coinPackId: 'pack-1',
        coins: 100,
        kind: 'COIN_PACK',
      },
    });
    // Force the tx to throw P2002 after the wallet credit already ran.
    prisma.$transaction.mockImplementationOnce(async () => {
      const err = new Error('unique constraint') as Error & { code: string };
      err.code = 'P2002';
      throw err;
    });
    const { svc } = makeService({ signatureValid: true, prisma });
    await expect(
      svc.verifyAndCredit('u-1', 'order-1', 'pay-1', 'sig'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('PaymentsService.verifyAndCreditWalletTopup', () => {
  it('rejects non-topup orders (coin-pack order sent to wallet path)', async () => {
    const prisma = makePrisma({
      paymentOrder: {
        razorpayOrderId: 'order-1',
        userId: 'u-1',
        coins: 100,
        kind: 'COIN_PACK',
      },
    });
    const { svc } = makeService({ signatureValid: true, prisma });
    await expect(
      svc.verifyAndCreditWalletTopup('u-1', 'order-1', 'pay-1', 'sig'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('happy path on a WALLET_TOPUP order credits Bet', async () => {
    const prisma = makePrisma({
      paymentOrder: {
        razorpayOrderId: 'order-1',
        userId: 'u-1',
        coins: 500,
        kind: 'WALLET_TOPUP',
      },
    });
    const { svc, betWallet } = makeService({
      signatureValid: true,
      betCredit: { balance: 1500, duplicate: false },
      prisma,
    });
    const result = await svc.verifyAndCreditWalletTopup(
      'u-1',
      'order-1',
      'pay-1',
      'sig',
    );
    expect(result).toEqual({ credited: 500, newBalance: 1500 });
    expect((betWallet.credit as jest.Mock).mock.calls[0][0]).toMatchObject({
      amount: 500,
      kind: 'wallet_topup',
    });
  });
});

describe('PaymentsService.createWalletTopupOrder', () => {
  it('rejects amounts below the floor', async () => {
    const prisma = makePrisma();
    const { svc } = makeService({ signatureValid: true, prisma });
    await expect(svc.createWalletTopupOrder('u-1', 50)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects amounts above the ceiling', async () => {
    const prisma = makePrisma();
    const { svc } = makeService({ signatureValid: true, prisma });
    await expect(
      svc.createWalletTopupOrder('u-1', 500_000),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates a WALLET_TOPUP PaymentOrder row at the right amount', async () => {
    const prisma = makePrisma();
    const { svc } = makeService({ signatureValid: true, prisma });
    const result = await svc.createWalletTopupOrder('u-1', 500);
    expect(result.amount).toBe(500);
    expect(result.currency).toBe('INR');
    expect(result.amountInPaise).toBe(50_000);
    expect(prisma.paymentOrder.create).toHaveBeenCalledTimes(1);
    expect(
      (prisma.paymentOrder.create as jest.Mock).mock.calls[0][0].data,
    ).toMatchObject({
      kind: 'WALLET_TOPUP',
      amountInr: 500,
      coins: 500,
    });
  });
});
