import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FoundationModule } from '../foundation/foundation.module';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrdersAdminController } from './orders-admin.controller';

/**
 * Orders module. Exports OrdersService so the auction settle path
 * (`AuctionsService.close()`) can call `createForWin()` — inside its
 * transaction — once a winner is decided.
 */
@Module({
  imports: [PrismaModule, FoundationModule],
  controllers: [OrdersController, OrdersAdminController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
