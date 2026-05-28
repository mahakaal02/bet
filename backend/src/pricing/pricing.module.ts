import { Module } from '@nestjs/common';
import { PermsGuard } from '../admin/perms.guard';
import { PricingController } from './pricing.controller';
import { PricingAdminController } from './pricing-admin.controller';
import { PricingService } from './pricing.service';
import { PricingEngine } from './pricing-engine.service';
import { PricingScheduler } from './pricing.scheduler';
import { CountryDetectionService } from './country-detection.service';
import {
  ForexProvider,
  ExchangeRateHostProvider,
  OpenErApiForexProvider,
} from './providers/forex.provider';
import { PppProvider, WorldBankPppProvider } from './providers/ppp.provider';

/**
 * PPP regional-pricing module.
 *
 * Clean-architecture wiring: the engine + service depend on the
 * ABSTRACT `ForexProvider` / `PppProvider` classes, bound here to
 * their concrete exchangerate.host / World Bank implementations via
 * `useClass`. Swapping a data source is a one-line change in this
 * file — no edits to the engine or service.
 *
 * PrismaService, RedisService, and AuditLogService come from their
 * `@Global()` modules so no `imports` are needed for them. PermsGuard
 * is provided locally (mirrors AdminModule) so the `@Perm()`-decorated
 * admin routes resolve their guard.
 */
@Module({
  controllers: [PricingController, PricingAdminController],
  providers: [
    PricingService,
    PricingEngine,
    PricingScheduler,
    CountryDetectionService,
    PermsGuard,
    // Both concrete forex impls are providers so the factory can pick.
    OpenErApiForexProvider,
    ExchangeRateHostProvider,
    // Default forex = open.er-api.com (no API key). If a deployment
    // sets EXCHANGERATE_HOST_KEY it gets the spec's preferred
    // exchangerate.host source instead. One env var, no code change.
    {
      provide: ForexProvider,
      useFactory: (
        openEr: OpenErApiForexProvider,
        exHost: ExchangeRateHostProvider,
      ): ForexProvider =>
        process.env.EXCHANGERATE_HOST_KEY ? exHost : openEr,
      inject: [OpenErApiForexProvider, ExchangeRateHostProvider],
    },
    { provide: PppProvider, useClass: WorldBankPppProvider },
  ],
  exports: [PricingService, PricingEngine, CountryDetectionService],
})
export class PricingModule {}
