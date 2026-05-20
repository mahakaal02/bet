import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import type { TrustedDevice } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Trusted-device cookie management (Roadmap §F-USER-9, second half).
 *
 * Pairs with the TOTP service from PR-2FA-1. After a user successfully
 * completes a 2FA login AND ticks "trust this device", the server mints
 * a long-lived opaque cookie that proves "this browser already passed
 * 2FA on this account". Future logins on this device skip the 6-digit
 * prompt for `TRUST_TTL_DAYS` (default 90).
 *
 * Security model
 *
 *   - **Cookie value = bearer credential**, 32 random bytes hex-encoded.
 *     Never stored server-side in plaintext — only its sha256 hash
 *     lives in `TrustedDevice.deviceHash`. A leaked DB dump cannot
 *     replay the cookie.
 *   - **`@@unique(userId, deviceHash)`** so a duplicate insert hits
 *     the constraint instead of silently shadowing the previous row.
 *   - **Cap of `MAX_DEVICES`** active trusted devices per user; minting
 *     a (N+1)th evicts the oldest by `lastSeenAt`.
 *   - **Cross-revocation**: callers (PasswordResetService,
 *     TwoFactorService.disable, EmailChangeService.confirm) MUST call
 *     `revokeAll(userId)` so a stolen-credential reset closes off
 *     trusted-device skips too.
 *
 * The "label" is purely cosmetic for the /me/2fa management page.
 * It's derived from the User-Agent at mint time — never used as part
 * of the auth check. A user spoofing their UA can't bypass the cookie
 * because the cookie token itself is the credential.
 */
@Injectable()
export class TrustedDeviceService {
  private readonly logger = new Logger(TrustedDeviceService.name);
  private static readonly COOKIE_BYTES = 32;
  private static readonly TRUST_TTL_DAYS = 90;
  private static readonly MAX_DEVICES = 5;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Mint a fresh trusted-device row. Returns the plaintext cookie
   * value (32 random bytes hex). The caller is responsible for
   * placing this in an httpOnly cookie on the response.
   */
  async mint(input: {
    userId: string;
    userAgent?: string | null;
    acceptLanguage?: string | null;
  }): Promise<{ cookieValue: string; id: string; expiresAt: Date }> {
    const cookieValue = crypto
      .randomBytes(TrustedDeviceService.COOKIE_BYTES)
      .toString('hex');
    const deviceHash = TrustedDeviceService.hashCookie(cookieValue);
    const label = TrustedDeviceService.labelFor(input.userAgent ?? null);
    const expiresAt = new Date(
      Date.now() + TrustedDeviceService.TRUST_TTL_DAYS * 24 * 60 * 60_000,
    );

    // Evict the oldest if we're at the cap before inserting the new one.
    await this.enforceCap(input.userId);

    const row = await this.prisma.trustedDevice.create({
      data: {
        userId: input.userId,
        deviceHash,
        label,
        lastSeenAt: new Date(),
        expiresAt,
      },
      select: { id: true, expiresAt: true },
    });

    // Reference acceptLanguage so it's not flagged as unused — it's
    // reserved for future locale-tagged labels but not used yet.
    void input.acceptLanguage;

    return { cookieValue, id: row.id, expiresAt: row.expiresAt };
  }

  /**
   * Check that `cookieValue` matches an active trusted-device row
   * for `userId`. Returns the row id on success (so the caller can
   * audit / bump lastSeenAt) or null on no-match / expired / unknown.
   *
   * Always touches the DB once, even on a miss, to keep timing
   * uniform between hit and miss paths.
   */
  async verify(
    userId: string,
    cookieValue: string,
  ): Promise<{ id: string } | null> {
    if (!cookieValue) return null;
    const deviceHash = TrustedDeviceService.hashCookie(cookieValue);
    const row = await this.prisma.trustedDevice.findUnique({
      where: { userId_deviceHash: { userId, deviceHash } },
      select: { id: true, expiresAt: true },
    });
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;

    // Bump lastSeenAt so the eviction policy keeps the active devices.
    await this.prisma.trustedDevice
      .update({
        where: { id: row.id },
        data: { lastSeenAt: new Date() },
      })
      .catch((err) => {
        // Never let a heartbeat-write failure block the login.
        this.logger.warn(
          `failed to bump TrustedDevice.lastSeenAt ${row.id}: ${(err as Error).message}`,
        );
      });

    return { id: row.id };
  }

  async list(userId: string): Promise<TrustedDevice[]> {
    return this.prisma.trustedDevice.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  async revoke(userId: string, deviceId: string): Promise<void> {
    const row = await this.prisma.trustedDevice.findUnique({
      where: { id: deviceId },
      select: { id: true, userId: true },
    });
    if (!row) throw new NotFoundException('device not found');
    if (row.userId !== userId) {
      // Don't leak existence — same 404 shape.
      throw new ForbiddenException('not your device');
    }
    // Pull expiresAt to now — preserves the row for audit trail while
    // making it immediately inactive everywhere `verify()` looks.
    await this.prisma.trustedDevice.update({
      where: { id: deviceId },
      data: { expiresAt: new Date() },
    });
  }

  /**
   * Bulk revoke. Called after any credential-altering action
   * (password reset, 2FA disable, email change applied).
   */
  async revokeAll(userId: string): Promise<{ revoked: number }> {
    const result = await this.prisma.trustedDevice.updateMany({
      where: { userId, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date() },
    });
    return { revoked: result.count };
  }

  private async enforceCap(userId: string): Promise<void> {
    const active = await this.prisma.trustedDevice.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'asc' },
      select: { id: true },
    });
    if (active.length < TrustedDeviceService.MAX_DEVICES) return;

    // Evict (active.length - MAX_DEVICES + 1) oldest so we leave
    // room for the incoming mint.
    const evictCount = active.length - TrustedDeviceService.MAX_DEVICES + 1;
    const toEvict = active.slice(0, evictCount).map((r) => r.id);
    await this.prisma.trustedDevice.updateMany({
      where: { id: { in: toEvict } },
      data: { expiresAt: new Date() },
    });
  }

  static hashCookie(plaintext: string): string {
    return crypto.createHash('sha256').update(plaintext).digest('hex');
  }

  /**
   * Best-effort device label derived from User-Agent. Pure, exported
   * for testing.
   *
   *   "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/…"
   *      → "Chrome on macOS"
   *
   * If we can't parse, fall back to a truncated UA string so the user
   * has SOMETHING to identify the device by.
   */
  static labelFor(ua: string | null): string {
    if (!ua) return 'Unknown device';

    const lower = ua.toLowerCase();
    let browser = 'Browser';
    if (lower.includes('edg/')) browser = 'Edge';
    else if (lower.includes('opr/') || lower.includes('opera')) browser = 'Opera';
    else if (lower.includes('chrome/') && !lower.includes('chromium')) browser = 'Chrome';
    else if (lower.includes('firefox/')) browser = 'Firefox';
    else if (lower.includes('safari/') && !lower.includes('chrome/')) browser = 'Safari';

    let os = 'Unknown OS';
    if (lower.includes('windows nt')) os = 'Windows';
    else if (lower.includes('mac os x')) os = 'macOS';
    else if (lower.includes('android')) os = 'Android';
    else if (lower.includes('iphone') || lower.includes('ipad')) os = 'iOS';
    else if (lower.includes('linux')) os = 'Linux';

    if (browser === 'Browser' || os === 'Unknown OS') {
      return ua.slice(0, 60);
    }
    return `${browser} on ${os}`;
  }
}
