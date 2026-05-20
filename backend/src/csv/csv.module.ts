import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FoundationModule } from '../foundation/foundation.module';
import { CsvExportService } from './csv-export.service';
import { CsvExportController } from './csv-export.controller';
import { CsvImportService } from './csv-import.service';
import { CsvImportController } from './csv-import.controller';

@Module({
  imports: [PrismaModule, FoundationModule],
  controllers: [CsvExportController, CsvImportController],
  providers: [CsvExportService, CsvImportService],
  exports: [CsvExportService, CsvImportService],
})
export class CsvModule {}
