import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BetWalletService } from '../bet-wallet/bet-wallet.service';
import { TelegramAuthDto } from './dto/telegram.dto';
import type { JwtPayload } from './auth.service';

/**
 * Telegram Login Widget — backend-side sign-in / sign-up
 * (PR-TELEGRAM-LOGIN).
 *
 * Two responsibilities:
 *
 *   1. Re-verify the HMAC over the Telegram payload using
 *      `TELEGRAM_BOT_TOKEN`. Defense-in-depth — the auctions
 *      callback already verifies once before forwarding, but
 *      both ends use the same secret so neither can be bypassed
 *      in isolation. A direct curl to `/auth/telegram` without
 *      a matching signature is rejected before any DB read.
 *
 *   2. Upsert the User row keyed on `telegramId`:
 *        • Existing user → refresh `telegram*` profile fields,
 *          return a JWT.
 *        • No user → create one with a synthesised username
 *          (their Telegram @username if available + unique
 *          suffix on collision; `tg_<id>` fallback). No
 *          password hash — these accounts authenticate only
 *          through Telegram.
 *
 * Wallet provisioning on Bet is fire-and-forget (same pattern as
 * the existing email signup): the first wallet operation lazily
 * runs `POST /api/internal/users/ensure` on the bet host.
 */
@Injectable()
export class TelegramAuthService {
  private readonly logger = new Logger(TelegramAuthService.name);

  /** Telegram's documented recommendation. Older payloads are
   *  rejected so a captured callback URL can't be replayed forever. */
  private static readonly AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;

  /** Tolerance for forward clock skew between our box and
   *  oauth.telegram.org. 60 seconds is generous for NTP-synced
   *  hosts but cheap to allow. */
  private static readonly CLOCK_SKEW_SECONDS = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly betWallet: BetWalletService,
  ) {}

  /**
   * Entry point. Returns `{ token, user }` in the same shape the
   * existing `/auth/login` route returns so the Next.js proxy can
   * treat the response identically.
   */
  async signInOrSignUp(payload: TelegramAuthDto): Promise<{
    token: string;
    user: {
      id: string;
      email: string | null;
      username: string;
      isAdmin: boolean;
      coinBalance: number;
    };
  }> {
    const botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      // Should never happen in production — surfaces immediately
      // in QA if the env wasn't wired.
      this.logger.error('TELEGRAM_BOT_TOKEN is not set; refusing to sign in.');
      throw new UnauthorizedException('Telegram login is not configured.');
    }

    if (!this.verifyHmac(payload, botToken)) {
      // Don't log the payload — that's how leaks happen. Just
      // record the auth_date so we can correlate with timing.
      this.logger.warn(
        `Telegram HMAC mismatch (auth_date=${payload.auth_date}).`,
      );
      throw new UnauthorizedException('Telegram signature is invalid.');
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.auth_date > now + TelegramAuthService.CLOCK_SKEW_SECONDS) {
      throw new BadRequestException('Telegram auth_date is in the future.');
    }
    if (now - payload.auth_date > TelegramAuthService.AUTH_MAX_AGE_SECONDS) {
      throw new UnauthorizedException('Telegram session has expired.');
    }

    // Look up the existing row (if any) by Telegram's stable
    // numeric ID. `telegramId` is BigInt in Prisma — convert from
    // the inbound JSON number.
    const telegramIdBig = BigInt(payload.id);

    // Pick a username for new accounts. We try (in order):
    //   1. The Telegram @username, lowercased + with a numeric
    //      collision-breaker appended on conflict.
    //   2. `tg_<id>` as a deterministic fallback.
    // The platform requires usernames to match /^[a-zA-Z0-9_]{3,20}$/
    // (see `RegisterDto`) so we sanitise Telegram's value first.
    const desiredUsername = await this.allocateUsername(
      payload.username,
      payload.id,
    );

    const user = await this.prisma.user.upsert({
      where: { telegramId: telegramIdBig },
      update: {
        telegramUsername: payload.username ?? null,
        telegramFirstName: payload.first_name,
        telegramLastName: payload.last_name ?? null,
        telegramPhotoUrl: payload.photo_url ?? null,
        telegramAuthDate: new Date(payload.auth_date * 1000),
      },
      create: {
        username: desiredUsername,
        // No password — these accounts authenticate only via Telegram.
        passwordHash: null,
        // Telegram doesn't reveal email; row stays without one.
        email: null,
        emailVerified: false,
        telegramId: telegramIdBig,
        telegramUsername: payload.username ?? null,
        telegramFirstName: payload.first_name,
        telegramLastName: payload.last_name ?? null,
        telegramPhotoUrl: payload.photo_url ?? null,
        telegramAuthDate: new Date(payload.auth_date * 1000),
        // Adopt the Telegram first name as the display name on
        // first sign-in. Users can change it later from the profile.
        displayName: payload.first_name,
      },
      select: {
        id: true,
        email: true,
        username: true,
        isAdmin: true,
        bannedAt: true,
      },
    });

    if (user.bannedAt) {
      // Same UX as the email/password login — short, vague, never
      // confirms the existence of an account.
      throw new UnauthorizedException('Account is restricted.');
    }

    // Wallet provisioning. The Bet internal /users/ensure endpoint
    // requires an email — Telegram doesn't return one, so we skip
    // provisioning here for telegram-only users. They get zero coin
    // balance until they add an email from the profile page; the
    // first wallet read after that lazily provisions the row.
    //
    // Existing users (e.g. signed up by email, later linked Telegram)
    // already have a `betUserId` and balance — `balance()` handles
    // that path natively.
    let coinBalance = 0;
    if (user.email) {
      // Email-having user — fire-and-forget ensure + then read balance.
      void this.betWallet.ensureUser(user.id).catch((err: unknown) => {
        this.logger.warn(
          `Bet wallet ensure failed for ${user.id}: ${(err as Error).message}`,
        );
      });
      coinBalance = await this.betWallet.balance(user.id).catch(() => 0);
    }

    const jwtPayload: JwtPayload = {
      sub: user.id,
      username: user.username,
      email: user.email ?? null,
    };
    const token = await this.jwt.signAsync(jwtPayload);

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        isAdmin: user.isAdmin,
        coinBalance,
      },
    };
  }

  /* ============================================================
     HMAC verification — RFC + Telegram spec
     ============================================================ */

  /**
   * Reproduces Telegram's "data-check-string" hashing per
   * https://core.telegram.org/widgets/login#checking-authorization
   *
   *   data-check-string = sorted(keys-except-hash)
   *     .map(k => `${k}=${data[k]}`)
   *     .join('\n')
   *   secret-key = SHA256(bot_token)
   *   computed  = HMAC_SHA256(secret-key, data-check-string)
   *
   * Compared in constant time to defeat timing side-channels.
   */
  private verifyHmac(payload: TelegramAuthDto, botToken: string): boolean {
    // Mirror the DTO into a string-keyed bag. We intentionally
    // include only the fields Telegram itself sent (i.e. we don't
    // sign undefined values) — sorted by key, excluding `hash`.
    const fields: Record<string, string> = {
      auth_date: String(payload.auth_date),
      first_name: payload.first_name,
      id: String(payload.id),
    };
    if (payload.last_name !== undefined) fields.last_name = payload.last_name;
    if (payload.photo_url !== undefined) fields.photo_url = payload.photo_url;
    if (payload.username !== undefined) fields.username = payload.username;

    const dataCheckString = Object.keys(fields)
      .sort()
      .map((k) => `${k}=${fields[k]}`)
      .join('\n');

    const secretKey = crypto.createHash('sha256').update(botToken).digest();
    const computed = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(computed, 'utf8'),
        Buffer.from(payload.hash, 'utf8'),
      );
    } catch {
      return false;
    }
  }

  /* ============================================================
     Username allocation — never collides, always valid
     ============================================================ */

  /**
   * Pick a username that's guaranteed unique AND that satisfies
   * the platform's `^[a-zA-Z0-9_]{3,20}$` rule. Strategy:
   *
   *   1. If Telegram returned a `username`, sanitise it (drop
   *      non-`[a-z0-9_]`, lowercase, clamp to 20 chars).
   *      If the result is available, use it.
   *   2. On collision, append a 3-digit random suffix and retry up
   *      to 5 times — collisions for a 13-char base + 3 random
   *      digits are astronomically unlikely (~1 in 1000).
   *   3. Final fallback: `tg_<id>` (always unique, since IDs are
   *      unique and `<id>` is at most ~10 digits).
   */
  private async allocateUsername(
    raw: string | undefined,
    telegramId: number,
  ): Promise<string> {
    const fallback = `tg_${telegramId}`.slice(0, 20);

    const sanitised = (raw ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 20);

    // Telegram min username length is 5; ours is 3. Anything that
    // sanitises to <3 chars (rare — e.g. only Cyrillic) falls back
    // to `tg_<id>` immediately.
    const candidates: string[] = [];
    if (sanitised.length >= 3) candidates.push(sanitised);

    // Generate 5 collision-breaker variants.
    const base = sanitised.length >= 3 ? sanitised.slice(0, 17) : '';
    if (base) {
      for (let i = 0; i < 5; i++) {
        const suffix = String(Math.floor(Math.random() * 900) + 100);
        candidates.push(`${base}${suffix}`.slice(0, 20));
      }
    }

    candidates.push(fallback);

    for (const candidate of candidates) {
      const existing = await this.prisma.user.findUnique({
        where: { username: candidate },
        select: { id: true },
      });
      if (!existing) return candidate;
    }

    // Should be unreachable — `tg_<id>` is unique unless we ALREADY
    // created a row for this telegramId, in which case the upsert
    // would have matched it. Defensive throw just in case.
    throw new ConflictException(
      'Could not allocate a unique username for the Telegram account.',
    );
  }
}
