import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FoundationModule } from '../foundation/foundation.module';
import { FraudService } from './fraud.service';
import { FraudController } from './fraud.controller';
import { FraudWorker } from './fraud.worker';

@Module({
  imports: [PrismaModule, FoundationModule],
  controllers: [FraudController],
  providers: [FraudService, FraudWorker],
  exports: [FraudService],
})
export class FraudModule {}
