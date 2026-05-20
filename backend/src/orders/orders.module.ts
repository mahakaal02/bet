import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FoundationModule } from '../foundation/foundation.module';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrdersAdminController } from './orders-admin.controller';

/**
 * Orders module. Exports OrdersService so the auction settle path
 * (BidsService.settleAuction, or the future scheduler) can call
 * `createForWin()` once a winner is decided.
 */
@Module({
  imports: [PrismaModule, FoundationModule],
  controllers: [OrdersController, OrdersAdminController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
