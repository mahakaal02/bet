import { Body, Controller, Get, Logger, Post, UseGuards } from '@nestjs/common';
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

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

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
