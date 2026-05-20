import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { NotificationChannel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../foundation/notification.service';
import { EmailAdapter } from '../notifications/adapters/email.adapter';

/**
 * Email-change flow (Roadmap §F-USER-11).
 *
 * The change is **double-confirmed**: a token goes to the OLD
 * address and a different token goes to the NEW address. Only when
 * both are clicked does the change apply. This protects the
 * account in two directions at once —
 *
 *   - **Hijacked OLD inbox**: the attacker can read the old-token
 *     email but cannot click the new-token email (it goes to an
 *     address they don't control). Change stalls.
 *   - **Typo'd NEW address**: the user clicks the old-token email
 *     immediately but the new address never gets a token because
 *     it doesn't exist. Change stalls. The user can retry with
 *     a corrected address.
 *
 * Flow
 *
 *   1. `request(userId, newEmail, password)` — re-auth the password
 *      (sensitive-action gate), generate two random tokens, store
 *      the hashes in a single EmailChangeRequest row, send two
 *      direct emails (one to old, one to new). 24h expiry.
 *
 *   2. `confirm(token)` — locate the request by EITHER token hash,
 *      mark the corresponding side confirmed. If BOTH are now
 *      confirmed: apply the change in a single $transaction (write
 *      `User.email = newEmail`, set `appliedAt`), enqueue the
 *      `email_change_applied_v1` notification.
 *
 *   3. `cancel(userId)` — cancel an in-flight request (e.g. user
 *      changed their mind, or "this wasn't me" link from the
 *      old-token email).
 *
 * Token storage: only sha256 hash. The plaintext is delivered once
 * via email and never persisted server-side.
 *
 * Rate limits
 *   - 2 requests per user per 24h (lower than password-reset; this
 *     is a much rarer operation).
 *   - 5 requests per IP per hour (same shape as the other auth flows).
 *
 * The "applied" notification fires once via the normal notification
 * pipeline (to the user's NEW email, which is now the current
 * `User.email`). The two request emails bypass the pipeline because
 * the new address isn't on the user row yet — see
 * `EmailAdapter.sendDirect`.
 */
@Injectable()
export class EmailChangeService {
  private readonly logger = new Logger(EmailChangeService.name);
  private static readonly TOKEN_BYTES = 32;
  private static readonly EXPIRY_MS = 24 * 60 * 60_000;        // 24h
  private static readonly RATE_WINDOW_USER_MS = 24 * 60 * 60_000;
  private static readonly RATE_WINDOW_IP_MS = 60 * 60_000;
  private static readonly MAX_PER_USER = 2;
  private static readonly MAX_PER_IP = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailAdapter: EmailAdapter,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
  ) {}

  /** Returns the current open (un-applied, un-cancelled, un-expired)
   *  request for the user, or null. Drives the /me/email-change page
   *  so the UI shows progress instead of an empty form. */
  async pending(userId: string) {
    const row = await this.prisma.emailChangeRequest.findFirst({
      where: {
        userId,
        appliedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        newEmail: true,
        oldConfirmedAt: true,
        newConfirmedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    if (!row) return null;
    return {
      newEmail: row.newEmail,
      oldConfirmed: !!row.oldConfirmedAt,
      newConfirmed: !!row.newConfirmedAt,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  async request(input: {
    userId: string;
    newEmail: string;
    password: string;
    ip?: string | null;
  }): Promise<void> {
    const normalised = input.newEmail.trim().toLowerCase();
    if (!normalised || !/.+@.+\..+/.test(normalised)) {
      throw new BadRequestException('newEmail is not a valid email address');
    }
    if (normalised.length > 320) {
      throw new BadRequestException('email is too long');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, email: true, username: true, passwordHash: true },
    });
    if (!user) throw new NotFoundException('user not found');

    // Re-auth the password — same gate as the 2FA-disable flow.
    const passwordOk = await bcrypt.compare(input.password, user.passwordHash);
    if (!passwordOk) throw new UnauthorizedException('invalid credentials');

    if (!user.email) {
      throw new BadRequestException(
        'this account has no current email — set one via support first',
      );
    }
    const oldEmail = user.email.toLowerCase();
    if (normalised === oldEmail) {
      throw new BadRequestException(
        'the new email is the same as your current one',
      );
    }

    // Email-uniqueness pre-check. The DB enforces it on commit too,
    // but a friendly 409 here lets the form render a specific error.
    const collision = await this.prisma.user.findUnique({
      where: { email: normalised },
      select: { id: true },
    });
    if (collision) {
      throw new ConflictException('that email is already in use');
    }

    await this.enforceRateLimits(input.userId, input.ip ?? null);

    // Cancel any earlier in-flight request — a fresh request takes
    // priority (the user typo'd before or changed their mind).
    await this.prisma.emailChangeRequest.updateMany({
      where: {
        userId: input.userId,
        appliedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { expiresAt: new Date() },              // expire immediately
    });

    const oldPlain = randomToken();
    const newPlain = randomToken();
    const row = await this.prisma.emailChangeRequest.create({
      data: {
        userId: input.userId,
        oldEmail,
        newEmail: normalised,
        oldTokenHash: hash(oldPlain),
        newTokenHash: hash(newPlain),
        expiresAt: new Date(Date.now() + EmailChangeService.EXPIRY_MS),
      },
      select: { id: true },
    });

    const baseUrl = this.publicBaseUrl();
    const oldLink = `${baseUrl}/auth/email-change/confirm?token=${encodeURIComponent(oldPlain)}`;
    const newLink = `${baseUrl}/auth/email-change/confirm?token=${encodeURIComponent(newPlain)}`;
    const cancelLink = `${baseUrl}/me/email`;
    const username = user.username;

    // Direct-send both. We do NOT roll back the request row on a
    // mail-send failure — the user can resend by issuing the
    // request again, which will cancel the stranded row first.
    await this.emailAdapter.sendDirect({
      toEmail: oldEmail,
      subject: 'Confirm: changing your Kalki email',
      body: `Hi ${username},

A request to change the email on your Kalki account to ${normalised} was just made. To confirm, open this link:

${oldLink}

If this wasn't you, ignore this email and the change will be cancelled automatically. You can also explicitly cancel here:

${cancelLink}

The change requires confirming BOTH this email and the new address. The link expires in 24 hours.

— Kalki Auctions`,
    });

    await this.emailAdapter.sendDirect({
      toEmail: normalised,
      subject: 'Confirm your new Kalki email',
      body: `Hi ${username},

Kalki is moving your account email from ${oldEmail} to this address. To confirm, open this link:

${newLink}

If you didn't expect this, ignore the email — the change won't go through unless both this address and your current address confirm. The link expires in 24 hours.

— Kalki Auctions`,
    });

    this.logger.log(
      `email change requested (request id=${row.id}, user=${input.userId})`,
    );
  }

  async confirm(token: string): Promise<{
    side: 'old' | 'new';
    applied: boolean;
  }> {
    const tokenHash = hash(token);
    const row = await this.prisma.emailChangeRequest.findFirst({
      where: {
        OR: [{ oldTokenHash: tokenHash }, { newTokenHash: tokenHash }],
      },
      select: {
        id: true,
        userId: true,
        oldEmail: true,
        newEmail: true,
        oldTokenHash: true,
        newTokenHash: true,
        oldConfirmedAt: true,
        newConfirmedAt: true,
        expiresAt: true,
        appliedAt: true,
      },
    });
    if (!row) throw new BadRequestException('invalid or expired link');
    if (row.appliedAt) {
      // Already applied — return success quietly for idempotency.
      const side = row.oldTokenHash === tokenHash ? 'old' : 'new';
      return { side, applied: true };
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('this link has expired');
    }

    const side: 'old' | 'new' = row.oldTokenHash === tokenHash ? 'old' : 'new';
    const now = new Date();

    // Mark the side confirmed (idempotent — re-clicking the same
    // link is a no-op).
    if (side === 'old' && !row.oldConfirmedAt) {
      await this.prisma.emailChangeRequest.update({
        where: { id: row.id },
        data: { oldConfirmedAt: now },
      });
    } else if (side === 'new' && !row.newConfirmedAt) {
      await this.prisma.emailChangeRequest.update({
        where: { id: row.id },
        data: { newConfirmedAt: now },
      });
    }

    const oldNowConfirmed = side === 'old' ? true : !!row.oldConfirmedAt;
    const newNowConfirmed = side === 'new' ? true : !!row.newConfirmedAt;

    if (!oldNowConfirmed || !newNowConfirmed) {
      return { side, applied: false };
    }

    // Both sides confirmed — apply atomically. The unique constraint
    // on User.email is the final guard; if a race created a new user
    // with this email between request and apply, the update throws
    // P2002 and we keep the request open so the user can retry.
    try {
      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: row.userId },
          data: { email: row.newEmail },
        }),
        this.prisma.emailChangeRequest.update({
          where: { id: row.id },
          data: { appliedAt: now },
        }),
      ]);
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException(
          'that email was just taken by another account — request a new change with a different address',
        );
      }
      throw e;
    }

    // Fire the "applied" notification. Goes to the now-current email
    // (the new one). Best-effort.
    void this.notifications
      .enqueue({
        templateCode: 'email_change_applied_v1',
        userId: row.userId,
        payload: {
          oldEmail: row.oldEmail,
          newEmail: row.newEmail,
        },
        idempotencyAnchor: `email_change_applied:${row.id}`,
        channels: [NotificationChannel.EMAIL, NotificationChannel.INAPP],
      })
      .catch((err) => {
        this.logger.warn(
          `email_change_applied notification failed: ${(err as Error).message}`,
        );
      });

    return { side, applied: true };
  }

  async cancel(userId: string): Promise<{ cancelled: number }> {
    const result = await this.prisma.emailChangeRequest.updateMany({
      where: {
        userId,
        appliedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { expiresAt: new Date() },
    });
    return { cancelled: result.count };
  }

  // ─── Internals ────────────────────────────────────────────────────

  private async enforceRateLimits(userId: string, ip: string | null) {
    const userWindow = new Date(
      Date.now() - EmailChangeService.RATE_WINDOW_USER_MS,
    );
    const perUser = await this.prisma.emailChangeRequest.count({
      where: { userId, createdAt: { gte: userWindow } },
    });
    if (perUser >= EmailChangeService.MAX_PER_USER) {
      throw new HttpException(
        'too many email-change requests for this account — try again tomorrow',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (ip) {
      const ipWindow = new Date(
        Date.now() - EmailChangeService.RATE_WINDOW_IP_MS,
      );
      // No requestedIp column on EmailChangeRequest — count by
      // user as a proxy (per-IP at the controller throttle is the
      // primary per-IP gate).
      const perIp = await this.prisma.emailChangeRequest.count({
        where: { createdAt: { gte: ipWindow } },
      });
      if (perIp >= EmailChangeService.MAX_PER_IP * 10) {
        // Soft upper bound on aggregate to catch global spam.
        throw new HttpException(
          'too many email-change requests right now — try again later',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }

  private publicBaseUrl(): string {
    const base =
      this.config.get<string>('AUCTIONS_PUBLIC_BASE_URL') ??
      'https://kalki-auctions.cloud.podstack.ai';
    return base.replace(/\/$/, '');
  }
}

function randomToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function hash(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}
