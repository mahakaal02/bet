import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsListController } from './notifications-list.controller';
import { NotificationsPreferencesController } from './preferences.controller';
import { TemplateRendererService } from './template-renderer';
import { InappAdapter } from './adapters/inapp.adapter';
import { PushAdapter } from './adapters/push.adapter';
import { EmailAdapter } from './adapters/email.adapter';
import { NotificationBroadcastGateway } from './notification-broadcast.gateway';
import { NotificationWorker } from './notification-worker';
import { OutbidListenerService } from './outbid-listener.service';
import { SesSender } from './adapters/ses-sender';
import { EmailWebhookService } from './email-webhook.service';
import { EmailWebhookController } from './email-webhook.controller';

/**
 * Notifications module. Owns the full pipeline:
 *
 *   Producer side (called from anywhere in the backend):
 *     `foundation.NotificationService.enqueue()` writes a Notification
 *     row to the DB in PENDING state.
 *
 *   Consumer side (this module):
 *     NotificationWorker drains PENDING rows every ~1.5s
 *       → TemplateRendererService renders body using the row's
 *         template + payload
 *       → InappAdapter / PushAdapter / EmailAdapter dispatches per
 *         channel
 *       → DB row advances to DELIVERED / SENT / RETRY / FAILED / DEAD
 *
 *   Realtime side:
 *     NotificationBroadcastGateway holds per-user Socket.IO rooms
 *     and pushes new deliveries + unread-count updates to open tabs.
 *
 *   REST surface:
 *     NotificationsListController        — list / mark read
 *     NotificationsPreferencesController — channel opt-out toggles
 *     NotificationsController (legacy)   — FCM device-token registry
 *
 *   Event hook:
 *     OutbidListenerService — invoked from BidsService.placeBid()
 *     after the new bid + wallet debit settle. First live event
 *     family is `auction_outbid_v1`.
 *
 * Flags (all in `FeatureFlag` table, seeded by the
 * 20260520140000_notify_seed migration; all default false):
 *   - notifications.enabled          — master worker switch
 *   - watchlist.enabled              — REST endpoints for watching
 *   - watchlist.outbid_notifications — outbid listener active
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret:
          config.get<string>('JWT_SECRET') ??
          'CHANGE_ME_jwt_secret_kalki_default',
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [
    NotificationsController,
    NotificationsListController,
    NotificationsPreferencesController,
    EmailWebhookController,
  ],
  providers: [
    NotificationsService, // legacy: FCM dispatcher + device-token registry
    TemplateRendererService,
    InappAdapter,
    PushAdapter,
    EmailAdapter,
    SesSender,
    EmailWebhookService,
    NotificationBroadcastGateway,
    NotificationWorker,
    OutbidListenerService,
  ],
  exports: [
    NotificationsService,
    OutbidListenerService,
    // Exported for flows that need to email an address that isn't
    // yet on the user's account row — currently only PR-EMAIL-1
    // (email-change confirmation tokens).
    EmailAdapter,
  ],
})
export class NotificationsModule {}
