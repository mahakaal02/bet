import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { PaymentsService } from './payments.service';
import {
  CreateWalletTopupOrderDto,
  VerifyPaymentDto,
} from './dto/payments.dto';

/**
 * User-facing wallet API.
 *
 * Historically the backend ran its own INR wallet ledger here. After the
 * Phase-1 unified-wallet migration, the canonical balance + history live
 * on Bet (Kalki Exchange) — so this controller is a thin facade that:
 *
 *   1. Creates Razorpay orders (delegated to `PaymentsService`).
 *   2. Verifies the client-side signature and credits Bet's wallet via
 *      `BetWalletService.credit`. Idempotent on (kind, reference).
 *   3. Reads the live Bet balance for the Aviator UI's instant refresh
 *      after a top-up / cashout (avoids a heavier `/auth/me` round-trip).
 *
 * The Aviator frontend's `WalletPanel` and the in-game "ADD ₹X" shortcut
 * both call into here — the URLs match the contract the Aviator client
 * already uses (`POST /wallet/topup/order` etc).
 */
@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('balance')
  async balance(@CurrentUser() user: AuthedUser) {
    const balance = await this.payments.walletBalance(user.id);
    return { balance };
  }

  @Post('topup/order')
  topupOrder(
    @Body() dto: CreateWalletTopupOrderDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.payments.createWalletTopupOrder(user.id, dto.amount);
  }

  @Post('topup/verify')
  topupVerify(
    @Body() dto: VerifyPaymentDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.payments.verifyAndCreditWalletTopup(
      user.id,
      dto.orderId,
      dto.paymentId,
      dto.signature,
    );
  }
}
