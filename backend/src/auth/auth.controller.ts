import { Body, Controller, Get, Logger, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, AuthedUser } from './current-user.decorator';
import { BetWalletService } from '../bet-wallet/bet-wallet.service';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly betWallet: BetWalletService,
  ) {}

  // Register is rate-limited harder than login because every successful
  // call materialises a new account row + idempotent wallet ensure on
  // Bet — a flood of registrations grinds the wallet host more than a
  // login bcrypt-CPU spike does.
  @Throttle({ register: { limit: 3, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  // Login throttle: 8 attempts per minute per IP. Pairs with the
  // bcrypt CPU cost (~80 ms/check at rounds=10) to give a worst-case
  // ~640 ms of work per attacker IP per minute — slow enough that an
  // online brute-force against an 8-char alphanum password would take
  // ~10^15 IP-minutes. Layer with the existing global throttler.
  @Throttle({ login: { limit: 8, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  /**
   * Whoami. Overrides `coinBalance` with the live Bet wallet balance so
   * the Android app shows the unified number (not the now-stale local
   * column). Falls back to the local column if Bet is unreachable — the
   * UI still lights up with the last-known balance under degradation
   * rather than zero.
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: AuthedUser): Promise<AuthedUser> {
    if (!this.betWallet.isConfigured()) return user;
    try {
      const balance = await this.betWallet.balance(user.id);
      return { ...user, coinBalance: balance };
    } catch (err) {
      this.logger.warn(
        `/auth/me: Bet balance fetch failed for ${user.id}, falling back to local column: ${
          err instanceof Error ? err.message : err
        }`,
      );
      return user;
    }
  }
}
