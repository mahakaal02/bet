import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AdminModule } from '../admin/admin.module';
import { ImpersonationController } from './impersonation.controller';
import { ImpersonationService } from './impersonation.service';

/**
 * Impersonation module. Imports JwtModule (own config so the secret
 * matches the rest of the app even if this module is registered
 * before AuthModule) and AdminModule for the PermsGuard.
 *
 * The JwtModule reuse means impersonation tokens are signed with
 * the same key as session tokens, which is what makes
 * `validateJwt()` accept them as normal sessions for the
 * impersonated user.
 */
@Module({
  imports: [
    AdminModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-secret',
      }),
    }),
  ],
  controllers: [ImpersonationController],
  providers: [ImpersonationService],
  exports: [ImpersonationService],
})
export class ImpersonationModule {}
