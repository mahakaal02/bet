import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FeatureFlagService } from '../foundation/feature-flags.service';
import { ReconciliationService } from './reconciliation.service';

/**
 * Nightly cron — 02:00 UTC every day. Computes the previous-day
 * reconciliation report. Gated by the `reconciliation.enabled`
 * feature flag (default OFF until first prod walkthrough).
 *
 * Run cadence rationale: 02:00 UTC = 07:30 IST. The bulk of Indian
 * traffic has wound down by midnight IST, so by 02:00 UTC the books
 * have ~2h to settle (out-of-order webhooks, retried payments) before
 * the snapshot is taken. Earlier and we'd be racing settlement; later
 * and the dashboard isn't ready for the EU-morning ops check-in.
 */
@Injectable()
export class ReconciliationWorker {
  private readonly logger = new Logger(ReconciliationWorker.name);

  constructor(
    private readonly recon: ReconciliationService,
    private readonly flags: FeatureFlagService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async runNightly() {
    const enabled = await this.flags.isEnabled('reconciliation.enabled');
    if (!enabled) {
      this.logger.debug('skip: reconciliation.enabled is off');
      return;
    }
    // Yesterday in UTC.
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60_000);
    const forDate = ReconciliationService.toUtcMidnight(yesterday);
    this.logger.log(`running nightly recon for ${forDate.toISOString()}`);
    const result = await this.recon.run({ forDate });
    this.logger.log(
      `recon ${result.reportId}: status=${result.status} discrepant=${result.usersDiscrepant ?? '?'}`,
    );
  }
}
