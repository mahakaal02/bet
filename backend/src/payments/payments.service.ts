import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BetWalletService } from '../bet-wallet/bet-wallet.service';

/**
 * Wallet read facade.
 *
 * Historically this service also created + verified Razorpay orders
 * (coin-pack purchases + arbitrary INR top-ups). Razorpay has been
 * removed platform-wide — the canonical wallet lives on Bet and the
 * only remaining payment path is Bet's NOWPayments crypto checkout.
 * What's left here is a thin balance read used by the Aviator UI's
 * `GET /wallet/balance` so it can refresh without a full `/auth/me`
 * round-trip.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly betWallet: BetWalletService,
  ) {}

  /**
   * Live wallet balance, sourced from Bet. Returns 0 when the Bet
   * wallet bridge isn't configured (dev without INTERNAL_API_SECRET /
   * BET_BASE_URL).
   */
  async walletBalance(userId: string): Promise<number> {
    if (!this.betWallet.isConfigured()) return 0;
    return this.betWallet.balance(userId);
  }
}
