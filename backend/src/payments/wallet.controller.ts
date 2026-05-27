import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateWalletOrderDto,
  CreateWalletTopupOrderDto,
  VerifyPaymentDto,
} from './dto/payments.dto';
import { DenyImpersonated } from '../foundation/decorators/deny-impersonated.decorator';

/**
 * User-facing wallet API.
 *
 * Historically the backend ran its own INR wallet ledger here. After
 * the Phase-1 unified-wallet migration the canonical balance + history
 * live on Bet (Kalki Exchange) — so this controller is a thin facade
 * over Razorpay + BetWalletService.
 *
 * URL layout (PR-ARCH-AUDIT, Stage E — unified Razorpay namespace):
 *
 *   GET  /wallet/balance
 *   POST /wallet/order           — { coinPackId? | amount? } → Razorpay order
 *   POST /wallet/verify          — { orderId, paymentId, signature }
 *
 * Backward-compat shims (deprecated, see PaymentsController):
 *   POST /payments/coin-pack/:id/order
 *   POST /payments/verify
 *   POST /wallet/topup/order
 *   POST /wallet/topup/verify
 *
 * The old paths keep working but are marked deprecated and emit a
 * `Deprecation: true` response header. Clients are expected to migrate
 * to /wallet/order + /wallet/verify within one release.
 */
@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('balance')
  async balance(@CurrentUser() user: AuthedUser) {
    const balance = await this.payments.walletBalance(user.id);
    return { balance };
  }

  // ── Unified Razorpay namespace (PR-ARCH-AUDIT, Stage E) ─────────

  /**
   * Create a Razorpay order. Body shape decides the flow:
   *
   *   { coinPackId: "..." }      — buy a packaged amount of coins.
   *   { amount: 500 }            — arbitrary INR top-up (100–100k).
   *
   * Exactly one of the two MUST be present. Both → 400; neither →
   * 400. The response shape includes a `kind` discriminator so the
   * client (currently Android + Aviator UI) can branch on the
   * downstream verify path.
   */
  @DenyImpersonated()
  @Post('order')
  async createOrder(
    @Body() dto: CreateWalletOrderDto,
    @CurrentUser() user: AuthedUser,
  ) {
    const hasPack = dto.coinPackId !== undefined && dto.coinPackId !== '';
    const hasAmount = dto.amount !== undefined && dto.amount !== null;
    if (hasPack && hasAmount) {
      throw new BadRequestException(
        'send EITHER coinPackId OR amount, not both',
      );
    }
    if (!hasPack && !hasAmount) {
      throw new BadRequestException(
        'one of coinPackId or amount is required',
      );
    }
    if (hasPack) {
      const order = await this.payments.createCoinPackOrder(
        user.id,
        dto.coinPackId!,
      );
      return { kind: 'COIN_PACK' as const, ...order };
    }
    const order = await this.payments.createWalletTopupOrder(
      user.id,
      dto.amount!,
    );
    return { kind: 'WALLET_TOPUP' as const, ...order };
  }

  /**
   * Verify a Razorpay payment + credit Bet's wallet. Dispatches by
   * the persisted PaymentOrder.kind so the client doesn't need to
   * tell us which flow this was — we look it up.
   */
  @DenyImpersonated()
  @Post('verify')
  async verify(
    @Body() dto: VerifyPaymentDto,
    @CurrentUser() user: AuthedUser,
  ) {
    const order = await this.prisma.paymentOrder.findUnique({
      where: { razorpayOrderId: dto.orderId },
      select: { kind: true },
    });
    if (!order) throw new NotFoundException('order not found');
    if (order.kind === 'WALLET_TOPUP') {
      const result = await this.payments.verifyAndCreditWalletTopup(
        user.id,
        dto.orderId,
        dto.paymentId,
        dto.signature,
      );
      return { kind: 'WALLET_TOPUP' as const, ...result };
    }
    const result = await this.payments.verifyAndCredit(
      user.id,
      dto.orderId,
      dto.paymentId,
      dto.signature,
    );
    return { kind: 'COIN_PACK' as const, ...result };
  }

  // ── Backward-compat shims (will be removed one release after
  //    Android + admin SPA cut over to /wallet/order + /wallet/verify) ─

  /** @deprecated use POST /wallet/order with { amount } */
  @DenyImpersonated()
  @Post('topup/order')
  topupOrder(
    @Body() dto: CreateWalletTopupOrderDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.payments.createWalletTopupOrder(user.id, dto.amount);
  }

  /** @deprecated use POST /wallet/verify */
  @DenyImpersonated()
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
