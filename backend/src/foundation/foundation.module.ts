import { Module, Global } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BetWalletModule } from '../bet-wallet/bet-wallet.module';
import { FeatureFlagService } from './feature-flags.service';
import { SettingsService } from './settings.service';
import { AuditLogService } from './audit-log.service';
import { NotificationService } from './notification.service';
import { OutboxService } from './outbox.service';
import { OutboxWorker } from './outbox.worker';
import { OUTBOX_DISPATCHER_REGISTRY } from './outbox-dispatcher';
import { BetWalletDebitDispatcher } from './outbox-dispatchers/bet-wallet-debit.dispatcher';
import { BetWalletCreditDispatcher } from './outbox-dispatchers/bet-wallet-credit.dispatcher';
import { RolesGuard } from './roles.guard';

/**
 * Foundation module — the shared substrate every feature-area
 * module imports. Marked `@Global` so consumers don't need to
 * import the module before injecting its providers.
 *
 * Providers shipped here:
 *
 *   - `FeatureFlagService` — Postgres-backed flag evaluator
 *   - `SettingsService` — typed runtime settings with env fallback
 *   - `AuditLogService` — append-only admin audit writer
 *   - `NotificationService` — channel-aware enqueue API
 *   - `OutboxService` — at-least-once cross-service substrate
 *   - `OutboxWorker` — polling worker that drains the outbox
 *   - `RolesGuard` — RBAC guard for `@Roles(...)` routes
 *
 * Dispatcher registry: per-kind side-effect dispatchers are
 * registered into the `OUTBOX_DISPATCHER_REGISTRY` multi-provider
 * token. Foundation contributes the two BetWallet dispatchers
 * (debit + credit). Feature modules contribute their own
 * dispatchers as they ship (FCM in PR-NOTIFY-2, SES in
 * PR-NOTIFY-3, Razorpay refund in PR-REFUND-1).
 *
 * Cache layers and worker scale-out (BullMQ, separate worker
 * pods) wire in dedicated follow-up PRs.
 */
@Global()
@Module({
  imports: [BetWalletModule],
  providers: [
    Reflector,
    FeatureFlagService,
    SettingsService,
    AuditLogService,
    NotificationService,
    OutboxService,
    OutboxWorker,
    BetWalletDebitDispatcher,
    BetWalletCreditDispatcher,
    // Multi-provider registry — each dispatcher contributes itself.
    // Feature modules `useExisting`-bind their own dispatchers to
    // this same token. Resolution at runtime is a single array
    // injection.
    {
      provide: OUTBOX_DISPATCHER_REGISTRY,
      useFactory: (
        debit: BetWalletDebitDispatcher,
        credit: BetWalletCreditDispatcher,
      ) => [debit, credit],
      inject: [BetWalletDebitDispatcher, BetWalletCreditDispatcher],
    },
    RolesGuard,
  ],
  exports: [
    FeatureFlagService,
    SettingsService,
    AuditLogService,
    NotificationService,
    OutboxService,
    RolesGuard,
  ],
})
export class FoundationModule {}
