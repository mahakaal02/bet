import { Body, Controller, Logger, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { TelegramAuthDto } from './dto/telegram.dto';
import { TelegramAuthService } from './telegram.service';

/**
 * `POST /auth/telegram` (PR-TELEGRAM-LOGIN).
 *
 * Single endpoint that both signs in existing Telegram-linked
 * accounts AND signs up new ones — the auctions Next.js callback
 * doesn't need to know whether this is a first-time user.
 *
 * Rate-limited harder than `/auth/login` because every cold call
 * here can materialise a new account + lazy wallet provisioning.
 * Same throttle key (`register`) used for the email signup route
 * so an attacker can't spread sign-up volume across both endpoints
 * to dodge the limit.
 */
@Controller('auth')
export class TelegramAuthController {
  private readonly logger = new Logger(TelegramAuthController.name);

  constructor(private readonly tgAuth: TelegramAuthService) {}

  @Throttle({ register: { limit: 5, ttl: 60_000 } })
  @Post('telegram')
  async telegramAuth(@Body() body: TelegramAuthDto) {
    return this.tgAuth.signInOrSignUp(body);
  }
}
