import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../foundation/notification.service';
import { NotificationChannel } from '@prisma/client';
import { TrustedDeviceService } from './trusted-device.service';
import { JwtUserCache } from './jwt-user-cache';

/**
 * Password-reset flow per Roadmap §F-USER-10.
 *
 *   1. `request({ email, ip })` — generate a 32-byte random token,
 *      hash it (sha256), store a `PasswordReset` row with 30-min
 *      expiry, enqueue the `password_reset_v1` notification carrying
 *      the plaintext token. Always returns void — caller treats every
 *      input as success (no email enumeration).
 *
 *   2. `confirm({ token, newPassword })` — locate the row by token
 *      hash, verify not-used + not-expired, hash + write the new
 *      password, bump `User.passwordChangedAt` so existing JWTs are
 *      invalidated (the JwtStrategy checks `iat >= passwordChangedAt`),
 *      mark the row `usedAt = now`. Enqueue `password_changed_v1`
 *      so the user is informed.
 *
 * Rate limits:
 *   - 3 reset requests per (case-insensitive) email per hour.
 *   - 5 reset requests per IP per hour.
 * Both counts come from the PasswordReset table itself — no Redis
 * dependency. The window is rolling (count rows whose `createdAt`
 * is within the last hour).
 *
 * Token storage: only the sha256 hash. A leaked DB dump can't be
 * used to consume tokens; the plaintext is delivered to the user
 * once via the email pipeline and never persisted server-side.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private static readonly TOKEN_BYTES = 32;
  private static readonly EXPIRY_MS = 30 * 60_000;          // 30 minutes
  private static readonly RATE_WINDOW_MS = 60 * 60_000;     // 1 hour
  private static readonly MAX_PER_EMAIL = 3;
  private static readonly MAX_PER_IP = 5;
  private static readonly MIN_PASSWORD_LEN = 8;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
    private readonly trustedDevice: TrustedDeviceService,
    private readonly userCache: JwtUserCache,
  ) {}

  /**
   * Step 1. Always returns void; never reveals whether the email is
   * registered. On a hit we generate + store + email the token. On
   * a miss we return silently — the timing is constant-ish because
   * we always touch Postgres for the rate-limit count.
   */
  async request(input: { email: string; ip?: string | null }): Promise<void> {
    const normalisedEmail = input.email.trim().toLowerCase();

    // Rate-limit checks fire BEFORE the user lookup so an attacker
    // can't side-channel "does this email exist" by timing the rate
    // limiter against the user query.
    await this.enforceRateLimits(normalisedEmail, input.ip ?? null);

    const user = await this.prisma.user.findUnique({
      where: { email: normalisedEmail },
      select: { id: true, email: true, username: true },
    });
    if (!user || !user.email) {
      this.logger.debug(
        `password reset requested for ${normalisedEmail} — no user, silently ignored`,
      );
      return;
    }

    const plaintext = crypto
      .randomBytes(PasswordResetService.TOKEN_BYTES)
      .toString('hex');
    const tokenHash = PasswordResetService.hash(plaintext);
    const expiresAt = new Date(Date.now() + PasswordResetService.EXPIRY_MS);

    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        requestedIp: input.ip ?? null,
      },
    });

    // Send the reset link via the notification pipeline. EMAIL only —
    // we don't want a leaked push notification revealing a reset
    // token to a device the attacker may control.
    const resetUrl = this.buildResetUrl(plaintext);
    await this.notifications.enqueue({
      templateCode: 'password_reset_v1',
      userId: user.id,
      payload: {
        resetUrl,
        username: user.username,
        expiresInMinutes: String(Math.floor(PasswordResetService.EXPIRY_MS / 60_000)),
      },
      idempotencyAnchor: `pwreset:${tokenHash.slice(0, 16)}`,
      channels: [NotificationChannel.EMAIL],
    });
  }

  /**
   * Step 2. Find the row by token hash, validate, rotate the password.
   * Always 400 on any failure (don't leak which of the three reasons
   * failed — the attacker treats them identically).
   */
  async confirm(input: { token: string; newPassword: string }): Promise<void> {
    const password = input.newPassword ?? '';
    if (password.length < PasswordResetService.MIN_PASSWORD_LEN) {
      throw new BadRequestException(
        `password must be at least ${PasswordResetService.MIN_PASSWORD_LEN} characters`,
      );
    }
    if (password.length > 128) {
      // bcrypt truncates at 72 bytes; cap above that defensively.
      throw new BadRequestException('password is too long');
    }

    const tokenHash = PasswordResetService.hash(input.token ?? '');
    const row = await this.prisma.passwordReset.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        usedAt: true,
        expiresAt: true,
        user: { select: { id: true, email: true, username: true } },
      },
    });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('reset link is invalid or expired');
    }

    const rounds = Number(this.config.get('BCRYPT_ROUNDS') ?? 10);
    const passwordHash = await bcrypt.hash(password, rounds);

    // Atomic: write the new password, mark the reset consumed, bump
    // passwordChangedAt so every existing JWT becomes invalid.
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: row.userId },
        data: { passwordHash, passwordChangedAt: now },
      }),
      this.prisma.passwordReset.update({
        where: { id: row.id },
        data: { usedAt: now },
      }),
    ]);

    // Drop the cached user row so `validateJwt` re-reads the freshly
    // bumped `passwordChangedAt` immediately on this pod (rather than
    // waiting out the cache TTL) — every existing JWT is now stale.
    this.userCache.invalidate(row.userId);

    // Revoke every trusted-device cookie too — a stolen password that
    // led to the reset shouldn't let the attacker keep skipping 2FA
    // from previously-trusted browsers. Best-effort: a failure here
    // doesn't roll back the password rotation (which is the primary
    // remediation), but we'd log it for follow-up.
    try {
      await this.trustedDevice.revokeAll(row.userId);
    } catch (err) {
      this.logger.warn(
        `failed to revoke trusted devices after password reset ${row.id}: ${(err as Error).message}`,
      );
    }

    // Inform the user the password just changed. If the attacker
    // did consume the token, the legitimate user sees this and can
    // hit "wasn't me" support to start a recovery.
    if (row.user) {
      await this.notifications.enqueue({
        templateCode: 'password_changed_v1',
        userId: row.userId,
        payload: { username: row.user.username },
        idempotencyAnchor: `pwchanged:${row.id}`,
        // Send through every channel — this is the safety net.
        channels: [
          NotificationChannel.EMAIL,
          NotificationChannel.PUSH,
          NotificationChannel.INAPP,
        ],
      });
    }
  }

  /**
   * Pure helper — hash the plaintext token with sha256. The DB stores
   * only this hash; the plaintext is delivered to the user once
   * through the email pipeline and never persisted server-side.
   */
  static hash(plaintext: string): string {
    return crypto.createHash('sha256').update(plaintext).digest('hex');
  }

  private async enforceRateLimits(email: string, ip: string | null) {
    const windowStart = new Date(
      Date.now() - PasswordResetService.RATE_WINDOW_MS,
    );

    // Per-email count — joined through the User row.
    const perEmail = await this.prisma.passwordReset.count({
      where: {
        createdAt: { gte: windowStart },
        user: { email },
      },
    });
    if (perEmail >= PasswordResetService.MAX_PER_EMAIL) {
      throw new HttpException(
        'too many reset requests for this email — try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (ip) {
      const perIp = await this.prisma.passwordReset.count({
        where: {
          createdAt: { gte: windowStart },
          requestedIp: ip,
        },
      });
      if (perIp >= PasswordResetService.MAX_PER_IP) {
        throw new HttpException(
          'too many reset requests from this IP — try again later',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }

  private buildResetUrl(token: string): string {
    const base =
      this.config.get<string>('AUCTIONS_PUBLIC_BASE_URL') ??
      'https://kalki-auctions.cloud.podstack.ai';
    return `${base.replace(/\/$/, '')}/auth/reset?token=${encodeURIComponent(
      token,
    )}`;
  }
}
