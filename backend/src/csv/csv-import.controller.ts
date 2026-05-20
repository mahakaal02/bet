import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Perm, PermsGuard } from '../admin/perms.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { CsvImportService } from './csv-import.service';

class ImportDto {
  // CSV payload inline. For larger files we'd switch to a multipart
  // upload, but the 10k-row cap keeps the JSON path workable
  // (worst case ~1.2 MB).
  @IsString() @MaxLength(2_000_000)
  csvText!: string;

  @IsOptional() @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  dryRun?: boolean;
}

@UseGuards(JwtAuthGuard, PermsGuard)
@Controller('admin/csv')
export class CsvImportController {
  constructor(private readonly svc: CsvImportService) {}

  @HttpCode(200)
  @Post('import/coin-packs')
  @Perm('*')  // ADMIN only — re-tighten when a coin-pack-specific slug lands
  importCoinPacks(
    @CurrentUser() user: AuthedUser,
    @Body() body: ImportDto,
    @Query('dryRun') dryRunFlag?: string,
  ) {
    const dryRun = parseFlag(body.dryRun, dryRunFlag, true);
    return this.svc.importCoinPacks({
      adminId: user.id,
      adminEmail: user.email ?? '',
      csvText: body.csvText,
      dryRun,
    });
  }

  @HttpCode(200)
  @Post('import/auctions')
  @Perm('*')
  importAuctions(
    @CurrentUser() user: AuthedUser,
    @Body() body: ImportDto,
    @Query('dryRun') dryRunFlag?: string,
  ) {
    const dryRun = parseFlag(body.dryRun, dryRunFlag, true);
    return this.svc.importAuctions({
      adminId: user.id,
      adminEmail: user.email ?? '',
      csvText: body.csvText,
      dryRun,
    });
  }
}

/**
 * `dryRun` precedence: body wins, then query string, then default.
 * Default is `true` — committing requires an explicit `?dryRun=false`
 * (or body `{ dryRun: false }`) so a misclick doesn't wipe a table.
 */
function parseFlag(bodyFlag: boolean | undefined, queryFlag: string | undefined, defaultVal: boolean): boolean {
  if (bodyFlag !== undefined) return bodyFlag;
  if (queryFlag === undefined) return defaultVal;
  const normalised = queryFlag.toLowerCase();
  if (normalised === 'true') return true;
  if (normalised === 'false') return false;
  throw new BadRequestException({ code: 'INVALID_DRYRUN', got: queryFlag });
}
