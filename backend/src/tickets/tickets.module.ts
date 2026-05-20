import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FoundationModule } from '../foundation/foundation.module';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';
import { TicketsAdminController } from './tickets-admin.controller';

@Module({
  imports: [PrismaModule, FoundationModule],
  controllers: [TicketsController, TicketsAdminController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
