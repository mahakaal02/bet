import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * HTTP client for the Bet (Kalki Exchange) wallet API. Bet is the
 * canonical wallet authority across the Kalki Bet platform — this
 * service is how the auctions backend (and, later, Aviator) participate
 * in that single balance.
 *
 * Two endpoints in play:
 *
 *   POST  /api/internal/users/ensure   ← idempotent user-create-by-email
 *   POST  /api/internal/wallet         ← debit / credit / balance
 *
 * Both require `Authorization: Bearer <INTERNAL_API_SECRET>` — the same
 * value must be set on both sides. The shared secret is the only thing
 * standing between this service and the real wallet, so set it from a
 * high-entropy value (openssl rand -base64 32) and rotate on the usual
 * cadence.
 */
@Injectable()
export class BetWalletService {
  private readonly logger = new Logger(BetWalletService.name);
  private readonly baseUrl: string | null;
  private readonly secret: string | null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.baseUrl =
      this.config.get<string>('BET_BASE_URL')?.replace(/\/$/, '') ?? null;
    this.secret = this.config.get<string>('INTERNAL_API_SECRET') ?? null;
    if (!this.baseUrl || !this.secret) {
      this.logger.warn(
        'BET_BASE_URL or INTERNAL_API_SECRET not set — wallet calls will throw 503',
      );
    }
  }

  isConfigured(): boolean {
    return !!(this.baseUrl && this.secret);
  }

  private require() {
    if (!this.baseUrl || !this.secret) {
      throw new ServiceUnavailableException('bet_wallet_not_configured');
    }
    return { baseUrl: this.baseUrl, secret: this.secret };
  }

  /**
   * Make sure the user has a betUserId. Calls /api/internal/users/ensure
   * which is idempotent and creates a Bet account on first call. The
   * resulting Bet ID is cached on the backend's User row so subsequent
   * wallet ops skip the round-trip.
   */
  async ensureUser(
    userId: string,
  ): Promise<{ betUserId: string; created: boolean }> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, username: true, betUserId: true },
    });
    if (!u) throw new NotFoundException('user_not_found');
    if (u.betUserId) return { betUserId: u.betUserId, created: false };
    if (!u.email) {
      throw new BadRequestException(
        'user has no email — cannot bridge to Bet wallet',
      );
    }

    const { baseUrl, secret } = this.require();
    const res = await fetch(`${baseUrl}/api/internal/users/ensure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        email: u.email,
        username: u.username,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      this.logger.error(
        `users/ensure failed: ${res.status} ${JSON.stringify(body)}`,
      );
      throw new ServiceUnavailableException(
        body.error ?? 'bet_users_ensure_failed',
      );
    }
    const body = await res.json();
    const betUserId = body.userId as string;

    // Cache. If two concurrent calls both create, the unique index on
    // betUserId rejects the second update; catch + reload.
    try {
      await this.prisma.user.update({
        where: { id: u.id },
        data: { betUserId },
      });
    } catch {
      const fresh = await this.prisma.user.findUnique({
        where: { id: u.id },
        select: { betUserId: true },
      });
      if (fresh?.betUserId) return { betUserId: fresh.betUserId, created: false };
    }

    return { betUserId, created: !!body.created };
  }

  /**
   * Debit `amount` coins from the user's Bet wallet. Idempotent on
   * (kind, reference). Throws appropriate NestJS exceptions so the
   * caller's existing error handling lights up:
   *
   *   400 BadRequestException → insufficient_coins / invalid_input
   *   404 NotFoundException   → user_not_found
   *   503 ServiceUnavailable → Bet wallet unreachable
   */
  async debit(args: {
    userId: string;
    amount: number;
    kind: string;
    reference: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ balance: number; duplicate: boolean }> {
    return this.callWallet({ op: 'debit', ...args });
  }

  /** Credit coins. Always succeeds modulo replays. */
  async credit(args: {
    userId: string;
    amount: number;
    kind: string;
    reference: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ balance: number; duplicate: boolean }> {
    return this.callWallet({ op: 'credit', ...args });
  }

  /** Read-only balance. Use sparingly — `/auth/me` should cache. */
  async balance(userId: string): Promise<number> {
    const { betUserId } = await this.ensureUser(userId);
    const { baseUrl, secret } = this.require();
    const res = await fetch(`${baseUrl}/api/internal/wallet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ op: 'balance', userId: betUserId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ServiceUnavailableException(body.error ?? 'bet_balance_failed');
    }
    const body = await res.json();
    return body.balance as number;
  }

  private async callWallet(args: {
    op: 'debit' | 'credit';
    userId: string;
    amount: number;
    kind: string;
    reference: string;
    metadata?: Record<string, unknown>;
  }) {
    const { betUserId } = await this.ensureUser(args.userId);
    const { baseUrl, secret } = this.require();
    const res = await fetch(`${baseUrl}/api/internal/wallet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        op: args.op,
        userId: betUserId,
        amount: args.amount,
        kind: args.kind,
        reference: args.reference,
        metadata: args.metadata,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      switch (body.error) {
        case 'insufficient_coins':
          throw new BadRequestException('insufficient_coins');
        case 'user_not_found':
          throw new NotFoundException('bet_user_not_found');
        case 'forbidden':
          throw new ForbiddenException('bet_wallet_forbidden');
        case 'invalid_input':
          throw new BadRequestException('invalid_input');
        case 'rate_limited':
          throw new BadRequestException('rate_limited');
        default:
          throw new ServiceUnavailableException(
            body.error ?? `bet_wallet_${args.op}_failed`,
          );
      }
    }
    return {
      balance: body.balance as number,
      duplicate: !!body.duplicate,
    };
  }
}
