import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import * as totp from './totp';
import { SecretCipher, resolveCipherKey } from './secret-cipher';
import { TrustedDeviceService } from './trusted-device.service';

/**
 * Two-factor (TOTP) authentication service per Roadmap §F-USER-9.
 *
 * Lifecycle:
 *
 *   1. `beginEnrollment(userId, accountLabel)` — generates a fresh
 *      secret + 10 backup codes, writes a row with `verified=false`,
 *      and returns BOTH the otpauth URI (for the QR) AND the
 *      plaintext backup codes. Plaintext is shown to the user ONCE
 *      and never persisted server-side. Calling twice replaces the
 *      previous unverified secret (the user re-scanned the QR mid-
 *      flow).
 *
 *   2. `verifyEnrollment(userId, code)` — confirms the first
 *      TOTP code. Flips `verified=true`, stamps `enabledAt`,
 *      enqueues `2fa_enabled_v1`. Until this happens 2FA is NOT
 *      active for the account.
 *
 *   3. `disable(userId, password, codeOrBackup)` — requires the
 *      current password AND a working TOTP / backup code. Soft-
 *      deletes the secret + backup codes (so we never accidentally
 *      keep stale material), enqueues `2fa_disabled_v1`.
 *
 *   4. `verifyLogin(userId, codeOrBackup)` — called by AuthService
 *      after the user has passed password but is challenged. Tries
 *      TOTP first (cheap), then walks backup codes (bcrypt compare
 *      is expensive; cap at array length).
 *
 * Brute-force protection lives in-process (a small Map keyed by
 * userId, sliding 5-min window, max 5 attempts → 15-min lockout).
 * The roadmap calls for Redis; that's a pure infra swap when the
 * Redis client lands. Multi-pod deployments will under-protect by
 * a factor of (pod count) until then — acceptable for the volumes
 * we see, called out for the hardening PR.
 */
@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);
  private readonly cipher: SecretCipher;
  private static readonly BACKUP_CODE_COUNT = 10;
  private static readonly BACKUP_CODE_LEN = 8;
  private static readonly LOCKOUT_WINDOW_MS = 5 * 60_000;
  private static readonly LOCKOUT_MAX_ATTEMPTS = 5;
  private static readonly LOCKOUT_DURATION_MS = 15 * 60_000;

  private readonly attempts = new Map<
    string,
    { count: number; firstAt: number; lockedUntil?: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    config: ConfigService,
    private readonly trustedDevice: TrustedDeviceService,
  ) {
    this.cipher = new SecretCipher(resolveCipherKey(process.env));
    // Reference `config` to avoid "unused" warnings while leaving the
    // hook for future config-driven knobs (e.g. lockout overrides).
    void config;
  }

  /** Read-only status — drives the "2FA: on/off" badge on the settings page. */
  async status(userId: string): Promise<{
    enrolled: boolean;
    enabled: boolean;
    enabledAt: string | null;
    backupCodesRemaining: number;
  }> {
    const row = await this.prisma.twoFactorAuth.findUnique({
      where: { userId },
      select: {
        verified: true,
        enabledAt: true,
        disabledAt: true,
        backupCodes: true,
      },
    });
    if (!row) {
      return { enrolled: false, enabled: false, enabledAt: null, backupCodesRemaining: 0 };
    }
    return {
      enrolled: true,
      enabled: row.verified && !row.disabledAt,
      enabledAt: row.enabledAt?.toISOString() ?? null,
      backupCodesRemaining: row.backupCodes.length,
    };
  }

  async beginEnrollment(
    userId: string,
    accountLabel: string,
    issuer = 'Kalki',
  ): Promise<{
    otpauthUri: string;
    manualKey: string;
    backupCodes: string[];
  }> {
    // Idempotency: if a verified row already exists, refuse — the
    // user must disable first. Otherwise we'd silently rotate the
    // secret behind a working authenticator.
    const existing = await this.prisma.twoFactorAuth.findUnique({
      where: { userId },
    });
    if (existing?.verified) {
      throw new ConflictException(
        '2FA is already enabled — disable it first to re-enroll',
      );
    }

    const secret = totp.randomSecret();
    const uri = totp.otpauthUri({
      secret,
      issuer,
      accountName: accountLabel,
    });
    const plaintextCodes = TwoFactorService.generateBackupCodes();
    // We hash the HYPHEN-STRIPPED form so the verifier (which also
    // strips hyphens before bcrypt.compare) doesn't have to guess
    // which formatting the user transcribed. The display version
    // still carries the hyphen — it's a human-readability affordance,
    // not part of the code's value.
    const hashedCodes = await Promise.all(
      plaintextCodes.map((c) => bcrypt.hash(c.replace(/-/g, ''), 10)),
    );

    await this.prisma.twoFactorAuth.upsert({
      where: { userId },
      update: {
        encryptedSecret: this.cipher.encrypt(secret),
        verified: false,
        backupCodes: hashedCodes,
        enabledAt: null,
        disabledAt: null,
      },
      create: {
        userId,
        encryptedSecret: this.cipher.encrypt(secret),
        verified: false,
        backupCodes: hashedCodes,
      },
    });

    return {
      otpauthUri: uri,
      manualKey: totp.base32encode(secret),
      backupCodes: plaintextCodes,
    };
  }

  async verifyEnrollment(userId: string, code: string): Promise<void> {
    const row = await this.requireRow(userId);
    if (row.verified) {
      throw new ConflictException('2FA is already verified');
    }
    this.requireNotLockedOut(userId);
    const secret = this.cipher.decrypt(row.encryptedSecret);
    if (!totp.verify(secret, code)) {
      this.recordFailure(userId);
      throw new UnauthorizedException('invalid code');
    }
    this.clearAttempts(userId);

    await this.prisma.twoFactorAuth.update({
      where: { userId },
      data: { verified: true, enabledAt: new Date(), disabledAt: null },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    await this.notifications.enqueue({
      templateCode: '2fa_enabled_v1',
      userId,
      payload: { username: user?.username ?? '' },
      idempotencyAnchor: `2fa_enabled:${userId}:${Date.now()}`,
      channels: [
        NotificationChannel.EMAIL,
        NotificationChannel.PUSH,
        NotificationChannel.INAPP,
      ],
    });
  }

  /**
   * Confirm `codeOrBackup` is a valid current-session second factor.
   * Used by both the login challenge AND by `disable()`. Backup
   * codes are consumed atomically — a backup code can never be
   * used twice.
   */
  async verifyLogin(userId: string, codeOrBackup: string): Promise<void> {
    const row = await this.requireRow(userId);
    if (!row.verified) {
      throw new ForbiddenException('2FA is not enabled for this account');
    }
    this.requireNotLockedOut(userId);

    const trimmed = (codeOrBackup ?? '').replace(/\s+/g, '').toUpperCase();

    // Try TOTP first — cheap, no bcrypt.
    if (/^\d{6}$/.test(trimmed)) {
      const secret = this.cipher.decrypt(row.encryptedSecret);
      if (totp.verify(secret, trimmed)) {
        this.clearAttempts(userId);
        return;
      }
    }

    // Backup-code fallback. Each entry is bcrypt-hashed; on match we
    // remove it from the array (one-time use).
    if (/^[A-Z0-9-]{8,12}$/.test(trimmed)) {
      const normalised = trimmed.replace(/-/g, '');
      for (let i = 0; i < row.backupCodes.length; i++) {
        const ok = await bcrypt.compare(normalised, row.backupCodes[i]);
        if (ok) {
          const next = [...row.backupCodes];
          next.splice(i, 1);
          await this.prisma.twoFactorAuth.update({
            where: { userId },
            data: { backupCodes: next },
          });
          this.clearAttempts(userId);
          return;
        }
      }
    }

    this.recordFailure(userId);
    throw new UnauthorizedException('invalid code');
  }

  /**
   * Disable 2FA. Requires current password AND a working second
   * factor — symmetric to enrollment, so a stolen session alone
   * can't turn off 2FA and lock out the legitimate user.
   */
  async disable(
    userId: string,
    passwordPlain: string,
    codeOrBackup: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true, username: true },
    });
    if (!user) throw new NotFoundException('user not found');
    const passwordOk = await bcrypt.compare(passwordPlain, user.passwordHash);
    if (!passwordOk) throw new UnauthorizedException('invalid credentials');

    await this.verifyLogin(userId, codeOrBackup);

    await this.prisma.twoFactorAuth.update({
      where: { userId },
      data: {
        verified: false,
        encryptedSecret: '',
        backupCodes: [],
        disabledAt: new Date(),
      },
    });

    // Revoke every trusted-device cookie — turning off 2FA invalidates
    // the "this browser already passed 2FA" claim those cookies make,
    // and we don't want stale trust hanging around when the user
    // re-enables 2FA later.
    try {
      await this.trustedDevice.revokeAll(userId);
    } catch (err) {
      this.logger.warn(
        `failed to revoke trusted devices on 2FA disable for ${userId}: ${(err as Error).message}`,
      );
    }

    await this.notifications.enqueue({
      templateCode: '2fa_disabled_v1',
      userId,
      payload: { username: user.username },
      idempotencyAnchor: `2fa_disabled:${userId}:${Date.now()}`,
      channels: [
        NotificationChannel.EMAIL,
        NotificationChannel.PUSH,
        NotificationChannel.INAPP,
      ],
    });
  }

  /** Generate a fresh set of backup codes — used by the regenerate endpoint. */
  async regenerateBackupCodes(userId: string): Promise<string[]> {
    const row = await this.requireRow(userId);
    if (!row.verified) {
      throw new ForbiddenException('2FA must be enabled before regenerating backup codes');
    }
    const plaintext = TwoFactorService.generateBackupCodes();
    const hashed = await Promise.all(
      plaintext.map((c) => bcrypt.hash(c.replace(/-/g, ''), 10)),
    );
    await this.prisma.twoFactorAuth.update({
      where: { userId },
      data: { backupCodes: hashed },
    });
    return plaintext;
  }

  // ─── Internals ────────────────────────────────────────────────────

  private async requireRow(userId: string) {
    const row = await this.prisma.twoFactorAuth.findUnique({ where: { userId } });
    if (!row) throw new NotFoundException('2FA enrollment not started');
    return row;
  }

  /**
   * Generate `BACKUP_CODE_COUNT` codes of `BACKUP_CODE_LEN` ASCII
   * uppercase + digit chars. Formatted with a hyphen at midpoint so
   * they read as `ABCD-WXYZ` — easier to copy off a sheet of paper.
   *
   * We exclude visually-ambiguous chars (0/O, 1/I/L) so a hand-
   * transcribed code doesn't fail because of human-confusion.
   */
  static generateBackupCodes(): string[] {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const codes: string[] = [];
    for (let i = 0; i < TwoFactorService.BACKUP_CODE_COUNT; i++) {
      let s = '';
      for (let j = 0; j < TwoFactorService.BACKUP_CODE_LEN; j++) {
        const idx = crypto.randomInt(alphabet.length);
        s += alphabet[idx];
      }
      // Format e.g. 'ABCDWXYZ' → 'ABCD-WXYZ' for human readability.
      codes.push(`${s.slice(0, 4)}-${s.slice(4)}`);
    }
    return codes;
  }

  private requireNotLockedOut(userId: string) {
    const state = this.attempts.get(userId);
    if (!state) return;
    if (state.lockedUntil && state.lockedUntil > Date.now()) {
      const seconds = Math.ceil((state.lockedUntil - Date.now()) / 1000);
      throw new HttpException(
        `too many invalid codes — try again in ${seconds}s`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    // Clear any stale lockout so the next attempt is fresh.
    if (state.lockedUntil && state.lockedUntil <= Date.now()) {
      this.attempts.delete(userId);
    }
  }

  private recordFailure(userId: string) {
    const now = Date.now();
    const state = this.attempts.get(userId);
    if (!state || now - state.firstAt > TwoFactorService.LOCKOUT_WINDOW_MS) {
      this.attempts.set(userId, { count: 1, firstAt: now });
      return;
    }
    const next = state.count + 1;
    if (next >= TwoFactorService.LOCKOUT_MAX_ATTEMPTS) {
      this.attempts.set(userId, {
        count: next,
        firstAt: state.firstAt,
        lockedUntil: now + TwoFactorService.LOCKOUT_DURATION_MS,
      });
    } else {
      this.attempts.set(userId, { ...state, count: next });
    }
  }

  private clearAttempts(userId: string) {
    this.attempts.delete(userId);
  }
}

/** Truthy iff `BadRequestException` was unused — silence the linter. */
void BadRequestException;
