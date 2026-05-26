import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { BetWalletModule } from '../bet-wallet/bet-wallet.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';
import { TwoFactorController } from './two-factor.controller';
import { TwoFactorService } from './two-factor.service';
import { TrustedDeviceController } from './trusted-device.controller';
import { TrustedDeviceService } from './trusted-device.service';
import { EmailChangeController } from './email-change.controller';
import { EmailChangeService } from './email-change.service';
import { TelegramAuthController } from './telegram.controller';
import { TelegramAuthService } from './telegram.service';
import { ResponsibleGamblingModule } from '../responsible-gambling/responsible-gambling.module';

@Module({
  imports: [
    PassportModule,
    BetWalletModule,
    ResponsibleGamblingModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-secret',
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN') ?? '7d' },
      }),
    }),
  ],
  controllers: [
    AuthController,
    PasswordResetController,
    TwoFactorController,
    TrustedDeviceController,
    EmailChangeController,
    TelegramAuthController,
  ],
  providers: [
    AuthService,
    JwtStrategy,
    PasswordResetService,
    TwoFactorService,
    TrustedDeviceService,
    EmailChangeService,
    TelegramAuthService,
  ],
  exports: [AuthService, JwtModule, TwoFactorService, TrustedDeviceService],
})
export class AuthModule {}
