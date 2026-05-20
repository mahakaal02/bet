import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FeatureFlagService } from '../foundation/feature-flags.service';
import { FraudService } from './fraud.service';

/**
 * Nightly cluster sweep — 03:00 UTC. Velocity rules fire inline
 * from request paths (see BidsService.placeBid). Cluster rules need
 * an aggregate view, so they run as a scheduled job.
 *
 * Cron is gated by the `fraud.evaluator_enabled` flag (default OFF)
 * — the security team flips it after reviewing default thresholds.
 */
@Injectable()
export class FraudWorker {
  private readonly logger = new Logger(FraudWorker.name);

  constructor(
    private readonly fraud: FraudService,
    private readonly flags: FeatureFlagService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runNightly() {
    const enabled = await this.flags.isEnabled('fraud.evaluator_enabled');
    if (!enabled) {
      this.logger.debug('skip: fraud.evaluator_enabled is off');
      return;
    }
    this.logger.log('running nightly fraud cluster sweep');
    const result = await this.fraud.runClusterSweep();
    this.logger.log(
      `sweep: ip=${result.ipClusters} device=${result.deviceClusters} referral=${result.referralClusters}`,
    );
  }
}
