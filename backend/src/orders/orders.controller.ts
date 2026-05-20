import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { OrdersService } from './orders.service';

/**
 * User-side order endpoints (Roadmap §F-USER-3).
 *
 *   GET  /me/orders               — list mine, newest first
 *   GET  /me/orders/:id           — detail (snapshot + tracking)
 *   POST /me/orders/:id/address   — bind shipping address (PENDING → AWAITING)
 *   POST /me/orders/:id/dispute   — open a dispute (IN_TRANSIT|DELIVERED → DISPUTED)
 *
 * The /address path expects { addressId } — the snapshot lives on
 * Order.shippingAddressSnapshot so later edits to ShippingAddress
 * don't change what ops ships to.
 */

class AddressDto {
  @IsString() @MaxLength(64)
  addressId!: string;
}

class DisputeDto {
  @IsString() @MinLength(10) @MaxLength(2000)
  reason!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('me/orders')
export class OrdersController {
  constructor(private readonly svc: OrdersService) {}

  @Get()
  list(@CurrentUser() user: AuthedUser) {
    return this.svc.listMine(user.id);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.svc.getMine(user.id, id);
  }

  @HttpCode(200)
  @Post(':id/address')
  setAddress(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() body: AddressDto,
  ) {
    return this.svc.setShippingAddress({
      userId: user.id,
      orderId: id,
      addressId: body.addressId,
    });
  }

  @HttpCode(200)
  @Post(':id/dispute')
  dispute(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() body: DisputeDto,
  ) {
    return this.svc.dispute({ userId: user.id, orderId: id, reason: body.reason });
  }
}
