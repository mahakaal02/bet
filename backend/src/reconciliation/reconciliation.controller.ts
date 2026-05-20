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
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Perm, PermsGuard } from '../admin/perms.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { ReconciliationService } from './reconciliation.service';

/**
 * Admin reconciliation endpoints. All gated by `reconciliation.view`
 * (AUDITOR + FINANCE) for reads and `reconciliation.run` (FINANCE only)
 * for mutations. The slugs already exist in MODERATOR-1; we add the
 * `reconciliation.run` entry to the FINANCE block in permissions.ts.
 */

class AckDto {
  @IsOptional() @IsString() @MinLength(4) @MaxLength(500)
  notes?: string;
}

@UseGuards(JwtAuthGuard, PermsGuard)
@Controller('admin/reconciliation')
export class ReconciliationController {
  constructor(private readonly svc: ReconciliationService) {}

  @Get('reports')
  @Perm('reconciliation.view')
  list(@Query('cursor') cursor?: string, @Query('limit') limitRaw?: string) {
    return this.svc.listReports({
      cursor,
      limit: limitRaw ? Number(limitRaw) : undefined,
    });
  }

  @Get('reports/:id')
  @Perm('reconciliation.view')
  detail(@Param('id') id: string) {
    return this.svc.getReport(id);
  }

  @HttpCode(200)
  @Post('discrepancies/:id/ack')
  @Perm('reconciliation.view')  // ack is read-tier — the action just adds a note
  ack(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() body: AckDto,
  ) {
    return this.svc.acknowledgeDiscrepancy({
      adminId: user.id,
      adminEmail: user.email ?? '',
      discrepancyId: id,
      notes: body.notes,
    });
  }

  @HttpCode(200)
  @Post('trigger')
  @Perm('reconciliation.run')
  trigger(@CurrentUser() user: AuthedUser) {
    return this.svc.triggerForToday(user.id, user.email ?? '');
  }
}
