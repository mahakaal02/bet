import { Module, Global } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { FeatureFlagService } from './feature-flags.service';
import { SettingsService } from './settings.service';
import { AuditLogService } from './audit-log.service';
import { NotificationService } from './notification.service';
import { OutboxService } from './outbox.service';
import { RolesGuard } from './roles.guard';

/**
 * Foundation module — the shared substrate every feature-area module
 * imports. Marked `@Global` so consumers don't have to import the
 * module before using its providers.
 *
 * Providers shipped here are skeleton-ready:
 *   - `FeatureFlagService` — Postgres-backed flag evaluator
 *   - `SettingsService` — typed runtime settings with env fallback
 *   - `AuditLogService` — append-only admin audit writer
 *   - `NotificationService` — channel-aware enqueue API
 *   - `OutboxService` — at-least-once cross-service write substrate
 *   - `RolesGuard` — RBAC guard for `@Roles(...)` routes
 *
 * Most providers ship in skeleton form — the wiring of BullMQ
 * workers, Redis caching, and per-channel adapters lands in
 * dedicated follow-up PRs (see `docs/PRODUCTION_ROADMAP.md`).
 */
@Global()
@Module({
  providers: [
    PrismaClient,
    Reflector,
    FeatureFlagService,
    SettingsService,
    AuditLogService,
    NotificationService,
    OutboxService,
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
