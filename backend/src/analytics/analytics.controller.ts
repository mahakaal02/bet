import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Perm, PermsGuard } from '../admin/perms.guard';
import { AnalyticsService } from './analytics.service';

@UseGuards(JwtAuthGuard, PermsGuard)
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(private readonly svc: AnalyticsService) {}

  /**
   * Conversion funnel.
   *   GET /admin/analytics/funnel?from=ISO&to=ISO
   *
   * Default window is last 30 days. Gated by audit.view since the
   * data is aggregate, not per-user PII.
   */
  @Get('funnel')
  @Perm('audit.view')
  funnel(@Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.funnel({ from: parseDate(from), to: parseDate(to) });
  }

  /**
   * Weekly cohort retention.
   *   GET /admin/analytics/cohort-retention?weeksBack=8&retentionWeeks=4
   */
  @Get('cohort-retention')
  @Perm('audit.view')
  cohort(
    @Query('weeksBack') weeksBackRaw?: string,
    @Query('retentionWeeks') retentionWeeksRaw?: string,
  ) {
    return this.svc.cohortRetention({
      weeksBack: weeksBackRaw ? Number(weeksBackRaw) : undefined,
      retentionWeeks: retentionWeeksRaw ? Number(retentionWeeksRaw) : undefined,
    });
  }
}

function parseDate(s?: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new BadRequestException({ code: 'INVALID_DATE', value: s });
  return d;
}
