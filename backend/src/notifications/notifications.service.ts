import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Push-notification dispatcher. If FIREBASE_CREDENTIALS_PATH is set, sends via
 * Firebase Cloud Messaging. Otherwise logs the would-be notification — the
 * scheduler still records winners correctly; nothing breaks during local dev.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private app?: admin.app.App;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const credsPath = this.config.get<string>('FIREBASE_CREDENTIALS_PATH');
    if (!credsPath) {
      this.logger.warn('FIREBASE_CREDENTIALS_PATH not set — notifications will be logged only');
      return;
    }
    try {
      this.app = admin.initializeApp({
        credential: admin.credential.cert(require(credsPath)),
      });
      this.logger.log('Firebase Admin initialised');
    } catch (e: any) {
      this.logger.error(`failed to init Firebase Admin: ${e?.message}`);
    }
  }

  async registerDevice(userId: string, token: string, platform: 'android' | 'ios') {
    return this.prisma.deviceToken.upsert({
      where: { token },
      update: { userId, platform },
      create: { userId, token, platform },
    });
  }

  async unregisterDevice(token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { token } });
  }

  async notifyUser(userId: string, payload: PushPayload): Promise<void> {
    const devices = await this.prisma.deviceToken.findMany({ where: { userId } });
    if (devices.length === 0) {
      this.logger.debug(`notify user=${userId}: no devices registered`);
      return;
    }
    if (!this.app) {
      this.logger.log(`[stub] notify user=${userId}: ${payload.title} — ${payload.body}`);
      return;
    }

    const message: admin.messaging.MulticastMessage = {
      tokens: devices.map((d) => d.token),
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
    };
    try {
      const response = await admin.messaging(this.app).sendEachForMulticast(message);
      // Prune tokens that FCM tells us are dead.
      const dead: string[] = [];
      response.responses.forEach((r, i) => {
        if (!r.success) {
          const code = r.error?.code ?? '';
          if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
            dead.push(devices[i].token);
          }
        }
      });
      if (dead.length) {
        await this.prisma.deviceToken.deleteMany({ where: { token: { in: dead } } });
      }
    } catch (e: any) {
      this.logger.error(`FCM send failed: ${e?.message}`);
    }
  }
}
