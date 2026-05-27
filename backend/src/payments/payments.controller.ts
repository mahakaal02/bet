import { Body, Controller, Header, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { PaymentsService } from './payments.service';
import { VerifyPaymentDto } from './dto/payments.dto';
import { DenyImpersonated } from '../foundation/decorators/deny-impersonated.decorator';

/**
 * Deprecated Razorpay surface (PR-ARCH-AUDIT, Stage E).
 *
 * Was the original Android-facing path for coin-pack purchases.
 * Superseded by `POST /wallet/order` + `POST /wallet/verify` which
 * unify pack + arbitrary-INR top-ups under one namespace. Kept here
 * as thin delegating wrappers so any in-flight Android build / older
 * cached app session keeps working; new clients use /wallet/*.
 *
 * The `Deprecation` response header (RFC draft) signals migration
 * to forensic-aware clients and surfaces in our gateway access logs.
 * Plan: remove this controller after one release once Android, the
 * admin SPA, and the bet/ Next.js BFF have all cut over.
 *
 * 308 redirects were considered but rejected: Retrofit/OkHttp does
 * NOT follow redirects on POST by default, and many older Android
 * versions on the field won't either. A thin delegating wrapper is
 * functionally equivalent and works with every client unchanged.
 */
@UseGuards(JwtAuthGuard)
@DenyImpersonated()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** @deprecated use POST /wallet/order with { coinPackId } */
  @Header('Deprecation', 'true')
  @Header('Sunset', 'Wed, 31 Dec 2026 00:00:00 GMT')
  @Header('Link', '</wallet/order>; rel="successor-version"')
  @Post('coin-pack/:id/order')
  createCoinPackOrder(@Param('id') id: string, @CurrentUser() user: AuthedUser) {
    return this.payments.createCoinPackOrder(user.id, id);
  }

  /** @deprecated use POST /wallet/verify */
  @Header('Deprecation', 'true')
  @Header('Sunset', 'Wed, 31 Dec 2026 00:00:00 GMT')
  @Header('Link', '</wallet/verify>; rel="successor-version"')
  @Post('verify')
  verify(@Body() dto: VerifyPaymentDto, @CurrentUser() user: AuthedUser) {
    return this.payments.verifyAndCredit(user.id, dto.orderId, dto.paymentId, dto.signature);
  }
}
