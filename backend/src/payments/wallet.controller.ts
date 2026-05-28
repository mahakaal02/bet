import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { PaymentsService } from './payments.service';

/**
 * User-facing wallet API.
 *
 * The canonical balance + history live on Bet (Kalki Exchange). After
 * the Razorpay removal this controller is a single read endpoint —
 * order creation + payment verification (previously POST /wallet/order,
 * /wallet/verify, /wallet/topup/*) are gone; the only remaining
 * top-up path is Bet's NOWPayments crypto checkout, owned by the Bet
 * app itself.
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
}
