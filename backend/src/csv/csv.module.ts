import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FoundationModule } from '../foundation/foundation.module';
import { CsvExportService } from './csv-export.service';
import { CsvExportController } from './csv-export.controller';

@Module({
  imports: [PrismaModule, FoundationModule],
  controllers: [CsvExportController],
  providers: [CsvExportService],
  exports: [CsvExportService],
})
export class CsvModule {}
