import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/auth.service';

const OTP_TTL_MS = 5 * 60_000; // 5 minutes
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 30_000;

function hashOtp(code: string) {
  return createHash('sha256').update(code).digest('hex');
}

function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

@Injectable()
export class WhatsappAuthService {
  private readonly logger = new Logger(WhatsappAuthService.name);
  private readonly isProd: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    this.isProd = (this.config.get<string>('NODE_ENV') ?? 'development') === 'production';
  }

  /**
   * Stage-1 signup. Hashes the password, generates a 6-digit OTP, persists a
   * PhoneOtp row, "sends" it (logs in dev; would call WhatsApp Cloud API or
   * Twilio in production).
   *
   * Re-running this for a phone re-issues a fresh OTP (with cooldown).
   */
  async startSignup(phone: string, username: string, password: string) {
    if (await this.prisma.user.findUnique({ where: { whatsappPhone: phone } })) {
      throw new ConflictException('phone already registered');
    }
    if (await this.prisma.user.findUnique({ where: { username } })) {
      throw new ConflictException('username already taken');
    }

    await this.enforceResendCooldown(phone);

    const passwordHash = await bcrypt.hash(password, 10);
    const code = String(randomInt(100_000, 999_999));
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    await this.prisma.phoneOtp.create({
      data: {
        phone,
        codeHash: hashOtp(code),
        expiresAt,
        username,
        passwordHash,
      },
    });

    await this.sendOtp(phone, code);
    return { sent: true, expiresAt, ...(this.isProd ? {} : { devCode: code }) };
  }

  /** Stage-2: consume the OTP, create the user, return JWT. */
  async verifyOtp(phone: string, code: string) {
    const otp = await this.prisma.phoneOtp.findFirst({
      where: { phone, consumed: false },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new UnauthorizedException('no pending OTP for this phone');
    if (otp.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('OTP expired');
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new UnauthorizedException('too many attempts');
    }

    const ok = safeEq(hashOtp(code), otp.codeHash);
    await this.prisma.phoneOtp.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });
    if (!ok) throw new UnauthorizedException('invalid OTP');

    if (!otp.username || !otp.passwordHash) {
      throw new BadRequestException('OTP is not bound to a pending signup');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.phoneOtp.update({ where: { id: otp.id }, data: { consumed: true } });

      const user = await tx.user.create({
        data: {
          username: otp.username!,
          passwordHash: otp.passwordHash!,
          whatsappPhone: phone,
          phoneVerified: true,
        },
      });

      return this.issue(user, this.sanitize(user));
    });
  }

  async login(phone: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { whatsappPhone: phone } });
    if (!user) throw new UnauthorizedException('invalid credentials');
    if (!user.phoneVerified) throw new UnauthorizedException('phone not verified');
    // OAuth-only accounts (e.g. Telegram-only sign-up that later linked
    // a phone) have no password — reject with the same generic message
    // so the response is indistinguishable from a wrong password.
    if (!user.passwordHash) throw new UnauthorizedException('invalid credentials');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('invalid credentials');
    return this.issue(user, this.sanitize(user));
  }

  async resend(phone: string) {
    const otp = await this.prisma.phoneOtp.findFirst({
      where: { phone, consumed: false },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || !otp.username || !otp.passwordHash) {
      throw new BadRequestException('no pending signup for this phone');
    }
    await this.enforceResendCooldown(phone);

    const code = String(randomInt(100_000, 999_999));
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    await this.prisma.phoneOtp.create({
      data: {
        phone,
        codeHash: hashOtp(code),
        expiresAt,
        username: otp.username,
        passwordHash: otp.passwordHash,
      },
    });
    await this.sendOtp(phone, code);
    return { sent: true, expiresAt, ...(this.isProd ? {} : { devCode: code }) };
  }

  private async enforceResendCooldown(phone: string) {
    const last = await this.prisma.phoneOtp.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });
    if (last && Date.now() - last.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      throw new BadRequestException('please wait before requesting another OTP');
    }
  }

  /**
   * Real-world: call WhatsApp Cloud API or Twilio here. In this build the
   * OTP is logged to the backend console (and returned in the API response
   * when NODE_ENV !== production) so signup is testable without API keys.
   */
  private async sendOtp(phone: string, code: string) {
    if (this.isProd) {
      // TODO: implement Meta WhatsApp Cloud API or Twilio call here.
      this.logger.warn(`[stub] would send WhatsApp OTP ${code} to ${phone}`);
    } else {
      this.logger.log(`[dev] OTP for ${phone} = ${code}`);
    }
  }

  private issue(
    u: { id: string; username: string; email: string | null; whatsappPhone: string | null },
    user: ReturnType<WhatsappAuthService['sanitize']>,
  ) {
    const token = this.jwt.sign({
      sub: u.id,
      username: u.username,
      email: u.email ?? undefined,
      phone: u.whatsappPhone ?? undefined,
    } satisfies JwtPayload);
    return { token, user };
  }

  private sanitize(u: {
    id: string;
    email: string | null;
    username: string;
    emailVerified: boolean;
    isAdmin: boolean;
    whatsappPhone: string | null;
    phoneVerified: boolean;
  }) {
    // `coinBalance: 0` is a contract placeholder — Bet holds the real
    // balance and `auth.controller.ts::me` overlays it.
    return {
      id: u.id,
      email: u.email,
      username: u.username,
      emailVerified: u.emailVerified,
      coinBalance: 0,
      isAdmin: u.isAdmin,
      whatsappPhone: u.whatsappPhone,
      phoneVerified: u.phoneVerified,
    };
  }
}
