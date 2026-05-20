import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { OrderStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Perm, PermsGuard } from '../admin/perms.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { OrdersService } from './orders.service';

/**
 * Admin order operations.
 *
 *   GET  /admin/orders                 — queue, filterable by status
 *   POST /admin/orders/:id/ship        — mark IN_TRANSIT
 *   POST /admin/orders/:id/delivered   — mark DELIVERED
 *   POST /admin/orders/:id/cancel      — emergency cancel
 *
 * Permission gates re-use the existing `withdrawal.approve` slug for
 * the ship/delivered/cancel actions (these are FINANCE-class ops
 * actions) and `withdrawal.view` for the queue read. A dedicated
 * `order.*` slug family lands when ops staffing gets a separate
 * role — for now FINANCE owns the queue.
 */

class ShipDto {
  @IsString() @MinLength(1) @MaxLength(64) carrierName!: string;
  @IsString() @MinLength(1) @MaxLength(64) trackingNumber!: string;
  @IsOptional() @IsString() @MaxLength(512) trackingUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class DeliveredDto {
  @IsOptional() @IsString() @MaxLength(200) deliveredBy?: string;
}

class CancelDto {
  @IsString() @MinLength(4) @MaxLength(500) reason!: string;
}

class QueueQueryDto {
  @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() limit?: number;
}

@UseGuards(JwtAuthGuard, PermsGuard)
@Controller('admin/orders')
export class OrdersAdminController {
  constructor(private readonly svc: OrdersService) {}

  @Get()
  @Perm('withdrawal.view')
  queue(@Query() q: QueueQueryDto) {
    return this.svc.listForAdmin({
      status: q.status,
      cursor: q.cursor,
      limit: q.limit ? Number(q.limit) : undefined,
    });
  }

  @HttpCode(200)
  @Post(':id/ship')
  @Perm('withdrawal.approve')
  ship(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() body: ShipDto,
  ) {
    return this.svc.ship({
      adminId: user.id,
      adminEmail: user.email ?? '',
      orderId: id,
      carrierName: body.carrierName,
      trackingNumber: body.trackingNumber,
      trackingUrl: body.trackingUrl,
      notes: body.notes,
    });
  }

  @HttpCode(200)
  @Post(':id/delivered')
  @Perm('withdrawal.approve')
  delivered(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() body: DeliveredDto,
  ) {
    return this.svc.markDelivered({
      adminId: user.id,
      adminEmail: user.email ?? '',
      orderId: id,
      deliveredBy: body.deliveredBy,
    });
  }

  @HttpCode(200)
  @Post(':id/cancel')
  @Perm('withdrawal.approve')
  cancel(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() body: CancelDto,
  ) {
    return this.svc.cancel({
      adminId: user.id,
      adminEmail: user.email ?? '',
      orderId: id,
      reason: body.reason,
    });
  }
}
