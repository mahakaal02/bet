import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { CoinPacksService } from '../coin-packs/coin-packs.service';
import { BetWalletService } from '../bet-wallet/bet-wallet.service';
import { RazorpayClient } from './razorpay.client';

export interface CreateOrderResult {
  orderId: string;
  razorpayKeyId: string;
  amountInPaise: number;
  currency: string;
  coinPackId: string;
}

/**
 * Arbitrary-amount INR wallet top-up (used by Aviator's "Pay" button and
 * by the in-game "ADD ₹X" shortcut when a user tries to bet beyond their
 * balance). 1 coin = ₹1 in Bet, so `coins` and `amountInr` are the same.
 */
export interface CreateWalletTopupOrderResult {
  orderId: string;
  razorpayKeyId: string;
  amountInPaise: number;
  currency: string;
  amount: number;
}

const MIN_WALLET_TOPUP_INR = 100;
const MAX_WALLET_TOPUP_INR = 100_000;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly packs: CoinPacksService,
    private readonly razorpay: RazorpayClient,
    private readonly betWallet: BetWalletService,
  ) {}

  async createCoinPackOrder(userId: string, coinPackId: string): Promise<CreateOrderResult> {
    const pack = await this.packs.getOrThrow(coinPackId);
    if (!pack.active) throw new BadRequestException('coin pack is inactive');

    const amountInPaise = new Decimal(pack.priceInr.toString()).times(100).toNumber();
    const receipt = `cp_${pack.id.slice(0, 8)}_${Date.now()}`;

    const order = await this.razorpay.createOrder(amountInPaise, 'INR', receipt);

    await this.prisma.paymentOrder.create({
      data: {
        userId,
        coinPackId: pack.id,
        razorpayOrderId: order.id,
        amountInr: pack.priceInr,
        coins: pack.coins,
      },
    });

    return {
      orderId: order.id,
      razorpayKeyId: this.razorpay.publicKeyId(),
      amountInPaise,
      currency: 'INR',
      coinPackId: pack.id,
    };
  }

  /**
   * Verify client-side signature, atomically credit coins, and record audit
   * rows. Idempotent on (reason, reference) — replaying the same paymentId
   * is a no-op that returns the existing CoinTransaction.
   */
  async verifyAndCredit(
    userId: string,
    orderId: string,
    paymentId: string,
    signature: string,
  ): Promise<{ creditedCoins: number; newBalance: number }> {
    if (!this.razorpay.verifyPaymentSignature(orderId, paymentId, signature)) {
      throw new BadRequestException('invalid signature');
    }

    const order = await this.prisma.paymentOrder.findUnique({
      where: { razorpayOrderId: orderId },
    });
    if (!order) throw new NotFoundException('order not found');
    if (order.userId !== userId) throw new BadRequestException('order belongs to a different user');

    // Idempotency at the backend tier — the local CoinTransaction audit
    // row keeps us in sync if Razorpay's webhook + the client verify both
    // fire. Even with the wallet on Bet, the (reason, reference) unique
    // index is the right gate so we don't double-credit.
    const existing = await this.prisma.coinTransaction.findFirst({
      where: { reason: 'razorpay_purchase', reference: paymentId },
    });
    if (existing) {
      const balance = await this.betWallet
        .balance(userId)
        .catch(() => 0);
      return { creditedCoins: existing.delta, newBalance: balance };
    }

    // Credit Bet's wallet. Idempotent on Bet's side too — if a race-loss
    // happens here, Bet will return `duplicate: true` instead of double-
    // crediting. We still want a local audit row for backend-side
    // reconciliation reports, so we insert into CoinTransaction after
    // the wallet credit settles.
    const result = await this.betWallet.credit({
      userId,
      amount: order.coins,
      kind: 'wallet_topup',
      reference: `razorpay:${paymentId}`,
      metadata: {
        source: 'auctions-backend',
        razorpayOrderId: orderId,
        coinPackId: order.coinPackId,
      },
    });

    // Local audit + PaymentOrder state, in a single transaction.
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.coinTransaction.create({
          data: {
            userId,
            delta: order.coins,
            reason: 'razorpay_purchase',
            reference: paymentId,
            metadata: { orderId, coinPackId: order.coinPackId, betDuplicate: result.duplicate },
          },
        });
        await tx.paymentOrder.update({
          where: { razorpayOrderId: orderId },
          data: {
            status: 'CAPTURED',
            razorpayPaymentId: paymentId,
            capturedAt: new Date(),
          },
        });
      });
    } catch (e: any) {
      // P2002 = another concurrent verify won the audit-row race. The
      // wallet credit already happened (idempotently), so the only
      // remaining thing is to surface the conflict.
      if (e?.code === 'P2002') {
        throw new ConflictException('payment already credited');
      }
      throw e;
    }

    return { creditedCoins: order.coins, newBalance: result.balance };
  }

  /**
   * Create a Razorpay order for an arbitrary INR top-up to the user's
   * unified wallet. Mirrors `createCoinPackOrder` but skips the CoinPack
   * SKU layer — Aviator + the in-game shortcut want raw rupee amounts.
   */
  async createWalletTopupOrder(
    userId: string,
    amount: number,
  ): Promise<CreateWalletTopupOrderResult> {
    const rupees = Math.floor(amount);
    if (!Number.isFinite(rupees) || rupees < MIN_WALLET_TOPUP_INR) {
      throw new BadRequestException(`minimum top-up is ₹${MIN_WALLET_TOPUP_INR}`);
    }
    if (rupees > MAX_WALLET_TOPUP_INR) {
      throw new BadRequestException(`maximum top-up is ₹${MAX_WALLET_TOPUP_INR}`);
    }

    const amountInPaise = rupees * 100;
    const receipt = `wt_${userId.slice(0, 8)}_${Date.now()}`;
    const order = await this.razorpay.createOrder(amountInPaise, 'INR', receipt);

    await this.prisma.paymentOrder.create({
      data: {
        userId,
        kind: 'WALLET_TOPUP',
        razorpayOrderId: order.id,
        amountInr: rupees,
        coins: rupees, // 1 coin = ₹1 in Bet
      },
    });

    return {
      orderId: order.id,
      razorpayKeyId: this.razorpay.publicKeyId(),
      amountInPaise,
      currency: 'INR',
      amount: rupees,
    };
  }

  /**
   * Verify the Razorpay signature for a wallet top-up and credit the Bet
   * wallet. Idempotent on the local `(reason, reference)` index so the
   * client-side verify + Razorpay webhook can both fire safely. The
   * wallet credit is also idempotent on Bet's side via `(kind, reference)`.
   */
  async verifyAndCreditWalletTopup(
    userId: string,
    orderId: string,
    paymentId: string,
    signature: string,
  ): Promise<{ credited: number; newBalance: number }> {
    if (!this.razorpay.verifyPaymentSignature(orderId, paymentId, signature)) {
      throw new BadRequestException('invalid signature');
    }

    const order = await this.prisma.paymentOrder.findUnique({
      where: { razorpayOrderId: orderId },
    });
    if (!order) throw new NotFoundException('order not found');
    if (order.userId !== userId) {
      throw new BadRequestException('order belongs to a different user');
    }
    if (order.kind !== 'WALLET_TOPUP') {
      throw new BadRequestException('order is not a wallet top-up');
    }

    const existing = await this.prisma.coinTransaction.findFirst({
      where: { reason: 'wallet_topup', reference: paymentId },
    });
    if (existing) {
      const balance = await this.betWallet.balance(userId).catch(() => 0);
      return { credited: existing.delta, newBalance: balance };
    }

    const result = await this.betWallet.credit({
      userId,
      amount: order.coins,
      kind: 'wallet_topup',
      reference: `razorpay:${paymentId}`,
      metadata: {
        source: 'auctions-backend',
        razorpayOrderId: orderId,
        flow: 'wallet_topup',
      },
    });

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.coinTransaction.create({
          data: {
            userId,
            delta: order.coins,
            reason: 'wallet_topup',
            reference: paymentId,
            metadata: { orderId, betDuplicate: result.duplicate },
          },
        });
        await tx.paymentOrder.update({
          where: { razorpayOrderId: orderId },
          data: {
            status: 'CAPTURED',
            razorpayPaymentId: paymentId,
            capturedAt: new Date(),
          },
        });
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException('payment already credited');
      }
      throw e;
    }

    return { credited: order.coins, newBalance: result.balance };
  }

  /**
   * Live wallet balance, sourced from Bet. Used by `/wallet/balance` so the
   * Aviator UI can refresh without a full `/auth/me` round-trip after a
   * top-up or in-game cashout.
   */
  async walletBalance(userId: string): Promise<number> {
    if (!this.betWallet.isConfigured()) return 0;
    return this.betWallet.balance(userId);
  }
}
