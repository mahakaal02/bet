import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { PaymentsService } from './payments.service';
import { VerifyPaymentDto } from './dto/payments.dto';

@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('coin-pack/:id/order')
  createCoinPackOrder(@Param('id') id: string, @CurrentUser() user: AuthedUser) {
    return this.payments.createCoinPackOrder(user.id, id);
  }

  @Post('verify')
  verify(@Body() dto: VerifyPaymentDto, @CurrentUser() user: AuthedUser) {
    return this.payments.verifyAndCredit(user.id, dto.orderId, dto.paymentId, dto.signature);
  }
}
