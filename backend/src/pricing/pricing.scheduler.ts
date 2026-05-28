import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PricingService } from './pricing.service';

/**
 * Annual pricing sync scheduler.
 *
 * Runs ONCE a year at 00:05 UTC on April 1 (`5 0 1 4 *`). The 5-minute
 * offset keeps it off the top-of-hour stampede that other Jan-1/Apr-1
 * jobs tend to cluster on.
 *
 * Why annual, not monthly/daily: the whole point of PPP-stable pricing
 * is a predictable user experience and no app-store-review churn from
 * prices that drift with daily forex. The sync freezes a yearly
 * snapshot; nothing recomputes prices in between.
 *
 * The cron is intentionally thin — all logic (locking, idempotency,
 * retry, publish) lives in PricingService.runAnnualPricingSync so the
 * exact same path is exercised by the manual /admin/pricing/sync
 * trigger. Single-replica safety comes from the Redis advisory lock
 * inside the service.
 */
@Injectable()
export class PricingScheduler {
  private readonly logger = new Logger(PricingScheduler.name);

  constructor(private readonly pricing: PricingService) {}

  // min hour day-of-month month day-of-week  → 00:05 UTC, Apr 1, every year.
  @Cron('5 0 1 4 *', { timeZone: 'UTC' })
  async annualSync(): Promise<void> {
    this.logger.log('annual pricing sync cron firing (Apr 1 UTC)');
    try {
      const result = await this.pricing.runAnnualPricingSync({ publish: true });
      this.logger.log(
        `annual pricing sync complete: year=${result.effectiveYear} ` +
          `rows=${result.rows} flagged=[${result.flaggedCountries.join(',')}]`,
      );
    } catch (err) {
      // Don't rethrow — a thrown error in a @Cron handler under
      // nest-schedule has no supervisor to catch it. Log loudly; the
      // existing pricing stays active (we never deactivated it), and
      // ops can re-run via POST /admin/pricing/sync.
      this.logger.error(
        `annual pricing sync FAILED — previous year's pricing remains active. ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
