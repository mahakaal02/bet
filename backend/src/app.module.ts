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
import { CampaignsModule } from './campaigns/campaigns.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      // Global default: 60 requests per minute per IP.
      { name: 'default', ttl: 60_000, limit: 60 },
      // Tight burst limit reserved for bid placement (see @Throttle there).
      { name: 'bid', ttl: 10_000, limit: 5 },
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
    CampaignsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
