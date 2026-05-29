import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { FoundationModule } from './foundation/foundation.module';
import { AuthModule } from './auth/auth.module';
import { AuctionsModule } from './auctions/auctions.module';
import { BidsModule } from './bids/bids.module';
import { CoinsModule } from './coins/coins.module';
import { CoinPacksModule } from './coin-packs/coin-packs.module';
import { PaymentsModule } from './payments/payments.module';
import { AdminModule } from './admin/admin.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AviatorModule } from './aviator/aviator.module';
import { WhatsappAuthModule } from './auth-whatsapp/auth-whatsapp.module';
import { UploadsModule } from './uploads/uploads.module';
import { WatchlistModule } from './watchlist/watchlist.module';
import { ResponsibleGamblingModule } from './responsible-gambling/responsible-gambling.module';
import { DailyLoginModule } from './daily-login/daily-login.module';
import { AddressesModule } from './addresses/addresses.module';
import { ProfileModule } from './profile/profile.module';
import { AccountDeletionModule } from './account-deletion/account-deletion.module';
import { ImpersonationModule } from './impersonation/impersonation.module';
import { KycModule } from './kyc/kyc.module';
import { ReferralsModule } from './referrals/referrals.module';
import { OrdersModule } from './orders/orders.module';
import { TicketsModule } from './tickets/tickets.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { FraudModule } from './fraud/fraud.module';
import { CsvModule } from './csv/csv.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { StorageModule } from './storage/storage.module';
import { PricingModule } from './pricing/pricing.module';
import { ImpersonationScopeGuard } from './foundation/guards/impersonation-scope.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      // Global default: 60 requests per minute per IP in production.
      // Local dev relaxes this heavily because every browser request
      // shares one IP (localhost) and the polling/SSE pages would
      // otherwise trip the limit during a normal walkthrough.
      // Override explicitly with THROTTLE_LIMIT if needed.
      {
        name: 'default',
        ttl: 60_000,
        limit: Number(process.env.THROTTLE_LIMIT) ||
          (process.env.NODE_ENV === 'production' ? 60 : 2000),
      },
      // Tight burst limit reserved for bid placement (see @Throttle there).
      // NOTE: every throttler in this array applies to ALL routes by
      // default; the per-route @Throttle({ bid: ... }) decorators on the
      // bid/aviator endpoints override this with the real 5/10s limit.
      // So locally we neutralise the *global* bid limit (it would
      // otherwise cap every page to 5 requests / 10s) while the
      // per-route decorators keep actual bid placement protected.
      {
        name: 'bid',
        ttl: 10_000,
        limit: Number(process.env.THROTTLE_BID_LIMIT) ||
          (process.env.NODE_ENV === 'production' ? 5 : 2000),
      },
    ]),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    FoundationModule,
    AuthModule,
    AuctionsModule,
    BidsModule,
    CoinsModule,
    CoinPacksModule,
    PaymentsModule,
    AdminModule,
    NotificationsModule,
    AviatorModule,
    WhatsappAuthModule,
    UploadsModule,
    WatchlistModule,
    ResponsibleGamblingModule,
    DailyLoginModule,
    AddressesModule,
    ProfileModule,
    AccountDeletionModule,
    ImpersonationModule,
    KycModule,
    ReferralsModule,
    OrdersModule,
    TicketsModule,
    ReconciliationModule,
    FraudModule,
    CsvModule,
    AnalyticsModule,
    CampaignsModule,
    StorageModule,
    PricingModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Global enforcement of @DenyImpersonated() (PR-ARCH-AUDIT,
    // Stage A). The guard reads metadata via Reflector — if the
    // route lacks @DenyImpersonated, this is a no-op. Routes that
    // carry it 403 any JWT with `purpose: 'impersonation'`.
    { provide: APP_GUARD, useClass: ImpersonationScopeGuard },
  ],
})
export class AppModule {}
