# Kalki — Production Readiness Roadmap

**Authored: 2026-05-20** · principal-engineer-and-systems-architect pass over the live monorepo (`backend/`, `bet/`, `auctions/`, `aviator/`, `admin/`, `shared/`, Android `app/`).

This is the **planning + design artifact** for the missing-features bundle. Every section below is sized to be implementable as a discrete PR by one engineer in 1–5 days, depending on complexity. The companion Foundation PR ships the cross-cutting infrastructure (audit log, RBAC roles, feature flags, runtime settings, notification queue, outbox, KYC + responsible-gambling shells, watchlist, shipping address, referral, support tickets) — so every follow-up PR can be **pure business logic on top of stable plumbing** rather than re-litigating substrates.

> **Scope reality check.** Implementing all 27 features end-to-end is realistically a 4–6-engineer team over 4–6 months. This document sequences that work into deploy-safe PRs with explicit feature flags, rollback plans, dependency edges, and infrastructure prerequisites. Where a feature requires a longer design conversation than is appropriate here, the section ends with a short list of open architecture questions to resolve before scheduling the PR.

---

## Table of contents

- [Part 0 — Principles & cross-cutting decisions](#part-0--principles--cross-cutting-decisions)
- [Part 1 — Cross-cutting foundations (Foundation PR)](#part-1--cross-cutting-foundations-foundation-pr)
  - [1A Notification system](#1a--notification-system)
  - [1B Outbox pattern + reconciler](#1b--outbox-pattern--reconciler)
  - [1C Admin audit log](#1c--admin-audit-log)
  - [1D RBAC + roles](#1d--rbac--roles)
  - [1E Feature flags](#1e--feature-flags)
  - [1F Runtime settings (replaces env-driven config)](#1f--runtime-settings)
  - [1G Background job runner (BullMQ)](#1g--background-job-runner-bullmq)
  - [1H Storage abstraction + image processor](#1h--storage-abstraction--image-processor)
  - [1I Email service](#1i--email-service)
  - [1J Idempotency keys](#1j--idempotency-keys)
- [Part 2 — User-side features (16)](#part-2--user-side-features-16)
- [Part 3 — Admin-side features (11)](#part-3--admin-side-features-11)
- [Part 4 — PR-sized execution roadmap](#part-4--pr-sized-execution-roadmap)
- [Part 5 — Infrastructure upgrades](#part-5--infrastructure-upgrades)
- [Part 6 — Monitoring & alerting](#part-6--monitoring--alerting)
- [Part 7 — Security audits & compliance checkpoints](#part-7--security-audits--compliance-checkpoints)

---

## Part 0 — Principles & cross-cutting decisions

**P-1. Idempotency everywhere.** Every write that crosses a network boundary (bid → wallet, payment → ledger, notification → FCM, etc.) carries an idempotency key. Receivers dedupe on `(kind, idempotencyKey)` unique index. No exceptions for money flow.

**P-2. Outbox for cross-service writes.** Any time a local DB write needs a side-effect on a remote service (Bet wallet, FCM, SES), the side-effect intent is written to a local `outbox` table inside the same transaction. A worker drains it with retries + backoff. This kills "we committed the bid but the wallet debit was lost" failure modes.

**P-3. Ledger-backed money.** All financial operations write a `Transaction` row in the same DB transaction as the balance change. Reconciliation jobs (Part 3 §9) sweep daily.

**P-4. Feature flags by default.** Every new feature ships behind a flag in the new `FeatureFlag` table. Flags can be toggled per-user-percentage (canary) or per-role (admin-only first). Rollback = flip flag; no redeploy.

**P-5. Runtime settings, not env vars.** Replace `process.env.SIGNUP_COIN_BONUS` style config with a `SystemSetting` table (typed, audited, versioned). Bootstrap from env at first deploy, then admin UI takes over.

**P-6. Append-only audit log.** Every admin write goes through middleware that captures `(actorId, action, target, before, after, ip, ua, timestamp)` into an immutable table. Read-only from app code; only DBA can prune (with a retention policy job).

**P-7. Soft delete + retention.** No hard deletes on user data. `deletedAt` columns + a retention job that purges after the legally-mandated window (Part 7 covers India DPDP / GDPR equivalency).

**P-8. Background jobs via BullMQ on existing Redis.** No new infra. Reuse the Redis we already have.

**P-9. Server is source of truth.** Client-side validation is UX-only; the server re-validates everything. Frontend optimistic updates are reconciled on socket events or REST refresh, never trusted.

**P-10. Observability is a deliverable, not a follow-up.** Every PR includes metric counters, structured logs with correlation IDs, and (where money moves) an alert rule.

---

## Part 1 — Cross-cutting foundations (Foundation PR)

This is the **shipped-now** infrastructure. See `claude/production-foundation` branch.

### 1A — Notification system

**Why first**: 6 user-side features (watchlist outbid, order tracking, daily streak, password reset, email change, KYC status, account deletion, support tickets) and 3 admin-side features (notification campaigns, withdrawal queue, fraud alerts) all need to push to users. One unified pipeline beats nine separate ones.

**Architecture**

```
emit("event_name", { userId, payload, channels: ["push","email","inapp"] })
    │
    ▼
[NotificationOutbox row]  ← same Tx as the business write
    │
    ▼  (BullMQ worker drains every 1s)
[Renderer: pick template by event_name + user locale]
    │
    ├─► [PushDeliveryJob]  → FCM/APNS (HTTP) → DeliveryReceipt row
    ├─► [EmailDeliveryJob] → SES/SendGrid    → DeliveryReceipt row
    └─► [InAppCreateJob]   → Notification row → WS broadcast
    │
    ▼ on permanent failure (5xx after 6 retries)
[DeadLetterRow] → admin alert
```

**Schema** (in Foundation PR, see `backend/prisma/schema.prisma`)

```prisma
model NotificationTemplate {
  id        String   @id @default(cuid())
  code      String   @unique          // e.g. "auction_outbid_v1"
  channel   NotificationChannel       // PUSH, EMAIL, INAPP
  locale    String   @default("en")
  // Handlebars-style template with strict variable list
  subject   String?
  body      String
  variables Json     @default("{}")   // { auctionTitle: "string", ... }
  active    Boolean  @default(true)
  version   Int      @default(1)
  updatedAt DateTime @updatedAt
  createdAt DateTime @default(now())
  @@unique([code, channel, locale])
}

enum NotificationChannel { PUSH EMAIL INAPP }

enum NotificationStatus {
  PENDING        // sitting in outbox
  RENDERED       // template + variables resolved
  SENT           // handed off to FCM/SES
  DELIVERED      // platform confirmed delivery (FCM only)
  FAILED         // 4xx — no retry
  RETRY          // 5xx — back in queue
  DEAD           // exhausted retries
}

model Notification {
  id           String              @id @default(cuid())
  userId       String
  templateCode String
  channel      NotificationChannel
  status       NotificationStatus  @default(PENDING)
  payload      Json                            // variables for the template
  rendered     Json?                           // subject + body after templating
  deliveryAttempts Int             @default(0)
  lastAttemptAt DateTime?
  deliveredAt  DateTime?
  readAt       DateTime?                       // INAPP only
  failureReason String?
  // Idempotency — uniq per (userId, event-instance) so retries don't dup
  idempotencyKey String   @unique
  createdAt    DateTime   @default(now())
  user         User       @relation(fields: [userId], references: [id])
  @@index([userId, status, createdAt])
  @@index([userId, readAt])
}

model DeviceToken {
  // Already exists in backend schema — extended:
  id          String   @id @default(cuid())
  userId      String
  platform    DevicePlatform                 // IOS, ANDROID, WEB
  token       String   @unique
  // Topic subscriptions for broadcast campaigns
  topics      String[] @default([])
  lastSeenAt  DateTime @default(now())
  // Soft-disable when FCM returns NOT_REGISTERED — don't ship to dead tokens
  disabledAt  DateTime?
  user        User     @relation(fields: [userId], references: [id])
  @@index([userId, disabledAt])
}

enum DevicePlatform { IOS ANDROID WEB }

model NotificationPreference {
  userId            String   @id
  outbid            Boolean  @default(true)
  auctionEnding     Boolean  @default(true)
  orderUpdates      Boolean  @default(true)
  dailyStreak       Boolean  @default(true)
  marketingPush     Boolean  @default(false)
  marketingEmail    Boolean  @default(true)
  responsibleGambling Boolean @default(true)   // can't be disabled in EU
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

**Services** (backend, in Foundation PR)

- `backend/src/notifications/notification.service.ts` — public `enqueue(event, userId, payload)` API. Writes the outbox row.
- `backend/src/notifications/notification.worker.ts` — BullMQ worker. Pulls outbox rows, renders, dispatches per channel, marks status.
- `backend/src/notifications/push.adapter.ts` — abstract `PushAdapter` interface with `FcmAdapter` impl. Easy to swap for APNS or OneSignal later.
- `backend/src/notifications/email.adapter.ts` — abstract `EmailAdapter` with `SesAdapter` impl.
- `backend/src/notifications/inapp.adapter.ts` — writes Notification row, broadcasts on WS to `notifications:user:{userId}` channel.

**Websocket events** (new — gateway: `notifications.gateway.ts`)

- Server → client: `NOTIFICATION_NEW` (one notification just created)
- Server → client: `NOTIFICATION_READ` (mark sync from another device)
- Client → server: `NOTIFICATION_MARK_READ` (with ack)

**Admin tooling** (Part 3 §10)

- Template editor (CRUD `NotificationTemplate`)
- Test-send to single user
- Delivery dashboard (success rate, failure breakdown)

**Security**

- Templates have a strict variable allowlist — Handlebars helpers are sandboxed, no `eval`
- Device tokens validated against FCM project before storing
- Outbid spam: per-user debounce (60s between push for same auction)
- Marketing notifications respect `NotificationPreference.marketingPush=false`
- Responsible-gambling required notifications (deposit limit reached, self-exclusion confirmation) can't be opted out of (regulatory)

**Rate limits**

- Per-user push: 60/hour, 10/minute (FCM token).
- Per-user email: 30/day.
- Hard cap on admin campaign blast: 100k/hour platform-wide.

**Analytics events**

- `notification.enqueued` `{event, userId, channel}`
- `notification.delivered` `{event, userId, channel, latencyMs}`
- `notification.failed` `{event, userId, channel, reason}`
- `notification.read` `{notificationId, userId, dwellMs}`

**Failure modes**

- FCM `NOT_REGISTERED` → soft-disable token, log, continue
- FCM 5xx → retry with backoff (1m, 5m, 30m, 2h, 12h, 24h then DEAD)
- SES bounce → mark email un-deliverable; nudge user to update
- Template render error → SKIP, alert admin (template bug)
- Worker crash mid-render → outbox row stays PENDING; next worker poll picks up

**Rollout**

- Foundation PR ships the tables + worker shell + adapters (no live sends; flag `notifications.enabled=false`).
- Follow-up PR-NOTIFY-1 wires in FCM credentials, enables push channel for one event (`auction_outbid`) with 5% canary.
- PR-NOTIFY-2 adds email channel + remaining events.

**Rollback**

- Flip `featureFlag.notifications.enabled=false` → worker stops dispatching. Outbox accumulates but doesn't ship.
- Templates versioned — rollback to previous version with one row update.

**Test plan**

- Unit: template renders variables correctly, missing variable errors are caught.
- Unit: outbox worker retries on 5xx, dead-letters after 6.
- Integration: emit `auction_outbid` → assert Notification + DeliveryReceipt + WS event.
- Load: 10k notifications/min through the worker (k6 script).

---

### 1B — Outbox pattern + reconciler

**Why**: Multiple cross-service writes today are at-most-once and can drop on network errors. The bid-placement → Bet-wallet-debit path (see [`backend/src/bids/bids.service.ts:98-125`](../backend/src/bids/bids.service.ts)) is the highest-stakes example.

**Schema**

```prisma
model Outbox {
  id            String   @id @default(cuid())
  // What kind of side-effect this row represents.
  kind          OutboxKind
  // The local entity that this side-effect is for (e.g. a Bid.id, a Cashout.id).
  // Used by reconciliation to map orphaned outbox rows back to source.
  sourceTable   String
  sourceId      String
  // Payload to send. Shape varies by kind.
  payload       Json
  // Idempotency key sent to the receiving service.
  idempotencyKey String  @unique
  status        OutboxStatus  @default(PENDING)
  attempts      Int          @default(0)
  nextAttemptAt DateTime     @default(now())
  lastError     String?
  completedAt   DateTime?
  createdAt     DateTime     @default(now())
  @@index([status, nextAttemptAt])
  @@index([sourceTable, sourceId])
}

enum OutboxKind {
  BET_WALLET_DEBIT      // bid → wallet
  BET_WALLET_CREDIT     // refund, cashout
  FCM_PUSH
  SES_EMAIL
  RAZORPAY_REFUND
  ADMIN_AUDIT_REPLAY    // re-fire admin actions to downstream auditors
}

enum OutboxStatus { PENDING IN_FLIGHT COMPLETED FAILED DEAD }
```

**Worker**: `backend/src/outbox/outbox.worker.ts` — every 500ms, claims up to 50 rows where `nextAttemptAt <= now AND status=PENDING`, sets `status=IN_FLIGHT`, dispatches by `kind`, then marks COMPLETED or schedules retry.

**Migration safety**: starts dual-writing. Cutover after the worker has caught up (no PENDING rows older than 30s).

**Compensating writes**: When the receiver returns a permanent error (4xx), the worker writes a compensating row (e.g. delete the local bid if the wallet debit was rejected).

**Failure modes**

- Receiving service down → row stays PENDING, retries with exponential backoff
- Local DB write succeeds but Outbox insert fails (won't happen — same tx)
- Worker process dies mid-IN_FLIGHT → orphaned row is reclaimed after 5min IN_FLIGHT timeout

**Observability**

- Counter: `outbox.pending`, `outbox.in_flight`, `outbox.dead`
- Alert: any DEAD row → page on-call
- Alert: PENDING > 1000 → reconcile pile-up
- Alert: oldest PENDING row > 5min → worker stalled

---

### 1C — Admin audit log

**Schema** (in Foundation PR)

```prisma
model AdminAuditLog {
  id          String   @id @default(cuid())
  actorId     String                          // admin user
  actorEmail  String                          // snapshot (in case user is later renamed)
  action      String                          // e.g. "auction.update", "withdrawal.approve", "user.ban"
  // Object the action targeted.
  targetType  String                          // "Auction", "User", "WithdrawalRequest"
  targetId    String
  before      Json?                           // row state before (sparse — only changed fields)
  after       Json?                           // row state after
  // Request metadata
  ipAddress   String?
  userAgent   String?
  correlationId String?                       // links request to log entry
  createdAt   DateTime @default(now())
  actor       User     @relation(fields: [actorId], references: [id])
  @@index([actorId, createdAt])
  @@index([targetType, targetId, createdAt])
  @@index([action, createdAt])
}
```

**Middleware**: `backend/src/admin/audit.middleware.ts` — wraps every admin route. Hooks the response, diffs `before` vs `after`, writes the audit row before returning.

**Access**: admins can read via `GET /admin/audit?actor=&target=&action=&from=&to=`. Search by full-text on action/target/before/after via Postgres `tsvector` (added in Part 3 §3 implementation PR).

**Retention**: 7 years (financial compliance). Archive to S3 after 2 years (cold storage tier).

**No update / delete API**: append-only. The only mutation is a yearly retention sweep that moves rows to S3 (separate, audited job).

---

### 1D — RBAC + roles

**Why**: `User.isAdmin: Boolean` is too coarse. We need moderator (read-only audit + limited writes) and finance (withdrawals + reconciliation, no auction edits) roles.

**Schema**

```prisma
model UserRole {
  userId  String
  role    Role
  grantedBy String?
  grantedAt DateTime @default(now())
  // Soft revoke for audit
  revokedAt DateTime?
  user    User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@id([userId, role])
}

enum Role {
  ADMIN          // god mode (creates other admins, schema, billing)
  MODERATOR      // user CRUD, ban/unban, content moderation, read-only ledger
  FINANCE        // withdrawal approval, reconciliation, ledger exports
  SUPPORT        // ticket access, read-only user data
  AUDITOR        // read-only access to audit log + all data, no writes
}
```

`isAdmin` column is kept for backward compatibility; a migration backfills `UserRole(ADMIN)` for every existing `isAdmin=true` row.

**Middleware**: `requireRole(...allowedRoles)` decorator on NestJS controllers. Reads `UserRole` rows joined to the JWT subject.

**Frontend**: `admin/` SPA shows/hides nav items by `roles` array in `/admin/me` response. Server-side checks are the actual gate.

**Audit**: every role grant/revoke writes an `AdminAuditLog` row with the granter as actor.

---

### 1E — Feature flags

```prisma
model FeatureFlag {
  id          String   @id                    // e.g. "watchlist.enabled"
  description String
  // Three modes — pick one per flag:
  //   - boolean:  ALL_ON / ALL_OFF
  //   - role:     enabled iff user has one of `roles`
  //   - percent:  enabled iff hash(userId, key) % 100 < `rolloutPercent`
  mode        FlagMode
  enabled     Boolean  @default(false)        // boolean mode
  roles       Role[]   @default([])           // role mode
  rolloutPercent Int   @default(0)            // percent mode (0-100)
  updatedBy   String?
  updatedAt   DateTime @updatedAt
  createdAt   DateTime @default(now())
}

enum FlagMode { BOOLEAN ROLE PERCENT }
```

**Service**: `FeatureFlagService.isEnabled(flagId, user)` — Redis-cached (10s TTL), Postgres-backed. Hot path: `O(1)` Redis GET.

**Pattern**:

```ts
if (!await flags.isEnabled('watchlist.enabled', user)) {
  throw new ForbiddenException('feature not enabled');
}
```

**Admin UI**: dedicated `FeatureFlags` page in admin. Every toggle writes an audit log row.

**Bulk emergency disable**: `featureFlag.kill_switch.global=true` short-circuits every other flag. One row, one toggle, all features off.

---

### 1F — Runtime settings

**Replaces**: scattered `process.env.SIGNUP_COIN_BONUS`, `process.env.WITHDRAW_MIN`, aviator min/max bet hardcoded as constants.

```prisma
model SystemSetting {
  key         String   @id                     // namespaced — "wallet.withdraw_min_coins"
  // Stored as JSON so it can carry numbers, strings, lists, nested objects.
  value       Json
  // Discriminator so the reader can validate at parse time:
  valueType   SettingType
  description String?
  updatedBy   String?
  updatedAt   DateTime @updatedAt
  createdAt   DateTime @default(now())
}

enum SettingType { INT FLOAT STRING BOOL JSON }

model SystemSettingHistory {
  id        String   @id @default(cuid())
  key       String
  // Snapshot of the previous + new value for forensic rollback
  before    Json?
  after     Json?
  changedBy String
  changedAt DateTime @default(now())
  @@index([key, changedAt])
}
```

**Settings catalog** (seeded in Foundation PR, all initialised from current env defaults):

| Key | Type | Default | Description |
|---|---|---|---|
| `wallet.withdraw_min_coins` | INT | 2000 | Minimum withdrawal in coins |
| `wallet.topup_min_coins` | INT | 100 | Minimum top-up in coins |
| `wallet.signup_bonus_coins` | INT | 10000 | New-account bonus |
| `aviator.min_bet_coins` | INT | 100 | Min bet per aviator round |
| `aviator.max_bet_coins` | INT | 10000 | Max bet per aviator round |
| `aviator.betting_window_ms` | INT | 10000 | Pre-round betting duration |
| `auctions.max_concurrent_bids_per_user` | INT | 10 | Anti-spam |
| `referral.bonus_referrer_coins` | INT | 500 | Reward when referee qualifies |
| `referral.bonus_referee_coins` | INT | 1000 | Sign-up bonus for referees |
| `rg.default_daily_loss_limit_coins` | INT | 50000 | Responsible-gambling default |
| `kyc.tier1_daily_withdraw_max_coins` | INT | 5000 | Pre-KYC daily cap |
| `kyc.tier2_daily_withdraw_max_coins` | INT | 50000 | Post-tier2 cap |
| `kyc.tier3_daily_withdraw_max_coins` | INT | 500000 | Post-tier3 cap |

**Service**: `SettingsService.get(key)` Redis-cached (60s TTL), Postgres-backed, env-var fallback for boot.

**Admin UI**: `Settings` page with grouped editor, validation per `valueType`, "Save" confirmation modal showing diff. Every save writes a `SystemSettingHistory` row.

**Migration**: bootstrap seed runs `INSERT … ON CONFLICT DO NOTHING` for each key. Existing env-driven code stays as fallback. Code migration to settings service happens per-feature.

---

### 1G — Background job runner (BullMQ)

**Why**: notification worker, outbox worker, daily reconciliation, retention sweep, FCM token cleanup, KYC document virus-scan, CSV export, etc.

**Choice**: BullMQ on the existing Redis. No new infra. Workers run inside the backend pod (one process, multiple queue workers) until volume justifies a separate `kalki-worker` deployment.

**Queues** (all defined in `backend/src/jobs/queue.ts`):

- `notifications` — outbid push, email delivery, in-app create
- `outbox` — drains the outbox table
- `reconciliation` — daily wallet ledger reconcile
- `kyc` — document virus scan, OCR (if added later)
- `exports` — CSV generation for trade history + ledger
- `cleanups` — retention sweep, dead token cleanup, expired token purge

**Cron jobs** (BullMQ repeatable):

- Daily 00:05 UTC: wallet reconciliation
- Daily 02:00 UTC: dead device token cleanup
- Weekly Sunday: retention sweep (notifications older than 90 days, audit log archive)
- Every 5 min: outbox health check (alert if PENDING > 1000)

**Observability**: BullMQ exposes Prometheus metrics via `bull-board`. Mount at `/admin/jobs` (auditor-role-only).

---

### 1H — Storage abstraction + image processor

**Why**: auction images (existing `imageUrls[]`), user avatars (new), KYC docs (new — sensitive), CSV exports (new — short-lived signed URLs), support ticket attachments.

**Design**: a single `StorageAdapter` interface with two implementations:
- `LocalDiskAdapter` for dev (writes under `/app/uploads/`, served via existing `/uploads/*` route)
- `S3Adapter` for prod (writes to a bucket, signed URLs for downloads, separate sensitive bucket for KYC docs)

**Image pipeline**: incoming image → virus scan (ClamAV sidecar) → mime sniff (file-type) → resize to N variants (sharp) → write each to storage → return signed URL set.

**KYC bucket policy**: server-side encryption with KMS, access logging, no public read, lifecycle rule (delete after 7 years per compliance).

**Avatar pipeline**: incoming image → mime sniff → strip EXIF (privacy) → resize to 256×256, 512×512, 1024×1024 webp → write to public bucket.

---

### 1I — Email service

`EmailAdapter` interface, `SesAdapter` impl (or SendGrid — equivalent). Templates live in `NotificationTemplate` table (channel=EMAIL). Two delivery modes: transactional (immediate) and marketing (campaign-queued, respects opt-out).

**Bounces + complaints**: SES sends SNS notifications → webhook on backend → marks `DeviceToken` / email un-deliverable.

---

### 1J — Idempotency keys

**Pattern**: every mutating API accepts an optional `Idempotency-Key` header. Backend stores `(userId, route, idempotencyKey) → response_snapshot` in Redis with 24h TTL. Replay returns the cached response, skipping the operation entirely.

**Implementation**: NestJS interceptor `IdempotencyInterceptor`, attached to routes via `@Idempotent()` decorator.

**Required on**: place bid, cashout, withdraw, transfer, KYC submit, account delete, ticket create.

---

## Part 2 — User-side features (16)

### F-USER-1 — Bid watchlist + outbid push notifications

**Status**: schema in Foundation PR (`Watchlist`). Business logic = follow-up PR `PR-WATCHLIST-1`.

**Schema**

```prisma
model Watchlist {
  id        String   @id @default(cuid())
  userId    String
  auctionId String
  // Don't notify if the user themselves just placed the bid that displaced their own previous bid.
  lastNotifiedAt DateTime?
  // De-dupe — at most one notification per auction per minute.
  user      User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  auction   Auction @relation(fields: [auctionId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  @@unique([userId, auctionId])
  @@index([auctionId])
}
```

**Backend flow**

1. `POST /auctions/:id/watch` / `DELETE /auctions/:id/watch` — feature-flagged.
2. Bid-placement service emits `bidder.displaced` event whenever a bid was the LOWEST_UNIQUE before and is no longer.
3. Listener: load `Watchlist` rows for that auction, exclude the new bidder, enqueue `outbid_notification` per watcher (debounced 60s).
4. Notification template `auction_outbid_v1` — push + email + in-app.

**UX**

- "★ Watch" toggle on auction tile + auction detail page.
- Profile page: "My watchlist" with sorting by ending-soonest, last-outbid-time.

**Rate limits**: 200 watchlist items per user, 1 push per auction per minute, 5 pushes per auction per day.

**Tests**: unit (debounce logic), integration (bid → watchlist → enqueue notification).

**Rollout**: flag `watchlist.enabled` → 5% canary → 100% over 3 days. Push channel separately flagged.

---

### F-USER-2 — Trade history / P&L export (CSV)

**Status**: requires Foundation PR (`exports` queue). Business logic = `PR-CSV-EXPORT-1`.

**Architecture**

1. `POST /me/exports/trade-history?from=&to=&format=csv` returns `{exportId, status: 'QUEUED'}`.
2. Worker generates CSV in S3, marks `Export.status=READY`, sends in-app notification with signed URL (6h TTL).
3. `GET /me/exports/:id` returns the download URL when ready.

**Schema**

```prisma
model UserExport {
  id        String   @id @default(cuid())
  userId    String
  kind      ExportKind          // TRADE_HISTORY, WALLET_LEDGER, BID_HISTORY
  filters   Json
  status    ExportStatus
  rowCount  Int?
  // S3 key — signed URL generated on demand
  fileKey   String?
  fileSizeBytes Int?
  // Auto-purged 7 days after generation
  expiresAt DateTime
  user      User     @relation(fields: [userId], references: [id])
  createdAt DateTime @default(now())
  @@index([userId, createdAt])
}

enum ExportKind { TRADE_HISTORY WALLET_LEDGER BID_HISTORY }
enum ExportStatus { QUEUED RUNNING READY FAILED EXPIRED }
```

**CSV format** (tax-friendly)

```csv
Date,Time(UTC),Date(IST),Time(IST),Type,Asset,Quantity,Price,Cost,Fee,Realized P&L,Running Balance,Reference
2026-04-12,14:33:01,2026-04-12,20:03:01,BUY,YES "Will BJP retain 2029",100,0.43,43.00,0.00,0.00,9957,trade:abc123
```

**Rate limit**: 1 export every 5 min, 10/day.

**Abuse**: signed URLs are tied to userId on generation; expired requests get a fresh signed URL only after re-auth.

**Tests**: unit (CSV formatter, timezone conversion), integration (queue → S3 → notification), load (50 concurrent exports of 100k rows).

---

### F-USER-3 — Position sharing with deeplink snapshot image

**PR**: `PR-SHARE-1`. Depends on F-USER-1 only because both use the notification + signed-URL pattern.

**Schema**

```prisma
model SharedPosition {
  id        String   @id @default(cuid())
  // Short share code, used in URL: /share/{code}
  code      String   @unique
  userId    String
  marketId  String
  // Snapshot — frozen at share time so the image doesn't change later
  snapshot  Json     // { side, shares, costBasis, currentPrice, pnl }
  // Generated OG image S3 key
  ogImageKey String?
  // Expiry — 90 days after creation
  expiresAt DateTime
  // Optional sharer text
  caption   String?
  // View counter (abuse + analytics)
  viewCount Int      @default(0)
  user      User     @relation(fields: [userId], references: [id])
  market    Market   @relation(fields: [marketId], references: [id])
  createdAt DateTime @default(now())
  @@index([userId])
}
```

**Generation**: `POST /me/positions/:positionId/share` → backend renders a 1200×630 PNG via `@vercel/og` style satori component, uploads to S3, writes the row. Returns `{ url: 'https://kalki-bet.cloud.podstack.ai/share/abc123' }`.

**OG meta**: `bet/app/share/[code]/page.tsx` reads the row and emits `<meta property="og:image" content="…">` pointing to the signed S3 URL.

**Abuse**: rate-limit 10 shares/user/hour, max 50 active shares/user. Expired rows auto-purge nightly.

---

### F-USER-4 — Referral codes + invite bonus

**Schema** (in Foundation PR — see `ReferralClaim`)

```prisma
model ReferralClaim {
  id         String   @id @default(cuid())
  referrerId String                            // who shared the code
  refereeId  String   @unique                  // who used the code (one-shot)
  code       String                            // snapshot of the code used
  // Lifecycle: claim → qualified → paid (or VOIDED on fraud)
  status     ReferralStatus  @default(PENDING)
  qualifiedAt DateTime?                        // when referee crossed the qualification threshold
  // Reward amounts — snapshot at time of claim so a settings change later doesn't backdate
  referrerRewardCoins Int
  refereeRewardCoins  Int
  // Anti-fraud: device + IP fingerprint at signup
  refereeSignupIp     String?
  refereeSignupDeviceHash String?
  // Anti-self-referral — checked at claim time
  voidReason String?
  referrer   User     @relation("ReferralReferrer", fields: [referrerId], references: [id])
  referee    User     @relation("ReferralReferee", fields: [refereeId], references: [id])
  createdAt  DateTime @default(now())
  @@index([referrerId, status])
}

enum ReferralStatus { PENDING QUALIFIED PAID VOIDED }
```

User schema gets `referralCode String @unique` (already present in Bet, add to backend `User`).

**Claim flow**

1. New user signs up with `?ref=ABC123` → backend looks up referrer, creates `ReferralClaim(PENDING)`.
2. Referee makes their first deposit ≥ 200 coins or places ≥ 1 bid → `qualified` job promotes to QUALIFIED.
3. Cron at 02:30 UTC → pays out QUALIFIED rows: credits both wallets via Outbox, updates to PAID.

**Anti-fraud**

- Same device hash across referrer + referee → auto-VOID.
- Same IP-octet-24 within 24h → flagged for admin review (not auto-void).
- Referee account dormant 30 days post-signup → forfeit, claim VOIDED.
- Tiered: every 5 successful referrals doubles the referrer reward (configurable via `referral.tier_multipliers` setting).

**Admin tooling**

- Referral search by code or referrer.
- Manual VOID with reason.
- Bulk audit: "show me referrers with > 20 claims this month."

**Tests**: unit (fraud detection), integration (signup → qualify → pay), abuse (try to self-refer).

---

### F-USER-5 — Profile customisation (avatar + display name)

**Schema additions to `User`**: `displayName String?` (1–40 char, moderated), `avatarKey String?` (S3 key in the avatars bucket).

**Username validation**

- 3-20 chars, alphanumeric + underscore
- Reserved list: admin, support, kalki, official, system, root, …
- Profanity filter (use `profanity-filter-extended` package, India + EN lists)
- Name change rate limit: once per 30 days

**Avatar pipeline** (see 1H): upload → virus scan → mime sniff → EXIF strip → resize → upload variants → store key.

**Moderation**

- Auto-block on profanity + reserved name.
- Soft-flag on rapid name changes (>2 in 90 days).
- Admin moderator dashboard: review queue for flagged profiles.

**Audit trail**: every name change written to `UserProfileHistory`:

```prisma
model UserProfileHistory {
  id        String   @id @default(cuid())
  userId    String
  field     String                            // "displayName", "avatarKey"
  before    String?
  after     String?
  changedAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id])
  @@index([userId, changedAt])
}
```

---

### F-USER-6 — Saved delivery/shipping address

**Schema** (in Foundation PR — see `ShippingAddress`)

```prisma
model ShippingAddress {
  id          String   @id @default(cuid())
  userId      String
  // Snapshot fields (not foreign-keyed to a country table because legal-name → country mapping is enough)
  fullName    String
  phoneE164   String                          // E.164 format
  line1       String
  line2       String?
  city        String
  state       String                          // ISO 3166-2 region code
  postalCode  String
  countryIso2 String                          // ISO 3166-1 alpha-2
  isDefault   Boolean  @default(false)
  // Soft delete — keep for past order references
  deletedAt   DateTime?
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([userId, deletedAt])
}
```

**Validation**

- Phone: `libphonenumber-js` parse, accept Indian (+91) numbers, others by E.164.
- Postal code: regex per country (Indian: `^\d{6}$`).
- Address profanity scan.

**Encryption at rest**

- The `line1`, `line2`, `phoneE164` columns are encrypted via Postgres `pgcrypto` (`pgp_sym_encrypt` with key from KMS). Decryption happens in app code, with the key never leaving the pod. Audit log captures only the address ID, never the content.

**Default address rule**

- Setting `isDefault=true` on one row auto-flips others to false via transactional update.
- Deleting the default address while others exist auto-promotes the most-recently-used.

---

### F-USER-7 — Order tracking after auction win

**Schema**

```prisma
model Order {
  id           String   @id @default(cuid())
  auctionId    String   @unique               // one order per won auction
  winnerId     String
  shippingAddressId String?                   // captured at checkout, snapshot if address later edited
  shippingAddressSnapshot Json?               // immutable snapshot for fulfillment
  status       OrderStatus  @default(PENDING_ADDRESS)
  fulfillmentNotes String?
  // Carrier + tracking
  carrierName  String?
  trackingNumber String?
  trackingUrl  String?
  // State transitions
  shippedAt    DateTime?
  deliveredAt  DateTime?
  deliveredBy  String?                        // admin who marked delivered, if user didn't confirm
  // Disputes
  disputedAt   DateTime?
  disputeReason String?
  auction      Auction  @relation(fields: [auctionId], references: [id])
  winner       User     @relation(fields: [winnerId], references: [id])
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@index([winnerId, status])
  @@index([status, updatedAt])
}

enum OrderStatus {
  PENDING_ADDRESS         // user hasn't supplied shipping yet
  AWAITING_FULFILLMENT    // address supplied, admin to ship
  IN_TRANSIT              // tracking number set
  DELIVERED               // confirmed delivered
  DISPUTED                // user reported issue
  CANCELLED               // admin-cancelled (refund handled separately)
}
```

**Flow**

1. Auction closes with winner → cron creates `Order(PENDING_ADDRESS)`.
2. Winner gets a notification: "You won! Confirm shipping address."
3. Winner sets/picks address → `Order.status = AWAITING_FULFILLMENT`, notification to admin.
4. Admin updates carrier + tracking → `Order.status = IN_TRANSIT`, notification to user.
5. Admin or user marks delivered → `Order.status = DELIVERED`.
6. Within 7 days of delivery, user can dispute → `Order.status = DISPUTED`, support ticket auto-created.

**Notifications**

- `order_pending_address` — to winner immediately after close
- `order_shipped` — when tracking added
- `order_delivered` — when status flips to DELIVERED
- `order_dispute_opened` — to admin support queue

**Admin UI**: `/admin/orders` queue with status filter, bulk update tracking numbers.

---

### F-USER-8 — Daily login / streak rewards

**Schema**

```prisma
model DailyLogin {
  userId    String   @id
  // Current streak (consecutive days)
  streak    Int      @default(0)
  // Day-of-streak (used to look up reward tier)
  lastClaimAt DateTime?
  // Streak protection — earned via consistent play (max 3)
  streakFreezes Int  @default(0)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model DailyLoginClaim {
  id        String   @id @default(cuid())
  userId    String
  // Day number in the streak when this was claimed (1-30)
  dayNumber Int
  rewardCoins Int
  // Anti-abuse: timezone-anchored claim window (UTC midnight)
  claimDateUtc DateTime                       // truncated to date
  user      User     @relation(fields: [userId], references: [id])
  @@unique([userId, claimDateUtc])            // one per day per user
  @@index([userId, claimDateUtc])
}
```

**Reward table** (stored in `SystemSetting.daily_login.rewards`):

```json
[
  { "day": 1, "coins": 50 },
  { "day": 2, "coins": 75 },
  { "day": 3, "coins": 100 },
  { "day": 7, "coins": 300, "bonus": "first_week" },
  { "day": 14, "coins": 700 },
  { "day": 30, "coins": 2000, "bonus": "loyalty" }
]
```

Days not in the table interpolate linearly. After day 30 the streak loops back to day 1 with a permanent bonus marker.

**Anti-abuse**

- Claim window: UTC date — one claim per UTC day per user. Display the user-local equivalent in the UI.
- Streak break = lastClaimAt was > 26h ago (gives 2h grace).
- Streak freeze: spend `streakFreezes` (max 3, earned every 14-day milestone) to skip a missed day.
- Backdoor prevention: can't claim for past days.

**Cron**: nightly 23:55 UTC → cleanup expired streaks (no claim in 26h), zero them.

**Notifications**

- Daily push (opt-in) at 9am user-local: "Day N reward ready — X coins."
- Streak-broken email if streak ≥ 7 was lost.

---

### F-USER-9 — 2FA (TOTP + backup codes)

**Schema**

```prisma
model TwoFactorAuth {
  userId          String   @id
  // Encrypted TOTP secret (pgp_sym_encrypt with KMS key)
  encryptedSecret String
  // Verified flag — set to true after the first successful TOTP submission
  verified        Boolean  @default(false)
  // Backup codes — bcrypt-hashed (so we can verify without storing plaintext)
  backupCodes     String[] @default([])       // 10 codes, each used-once
  // Trusted devices (cookie value bound to userId + deviceHash)
  // Up to 5 trusted devices per user
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  enabledAt       DateTime?
  disabledAt      DateTime?
  createdAt       DateTime @default(now())
}

model TrustedDevice {
  id          String   @id @default(cuid())
  userId      String
  // Hash of user agent + accept-language + a server-issued random — stable per device, opaque to user
  deviceHash  String
  label       String?                         // user-supplied "MacBook Air"
  lastSeenAt  DateTime @default(now())
  expiresAt   DateTime                        // 90d
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, deviceHash])
  @@index([userId, expiresAt])
}
```

**Flow**

1. Enable: server generates secret → returns QR + manual key + 10 backup codes (shown once).
2. User scans, enters first code → `verified=true`, `enabledAt=now()`.
3. Future login: after password, prompt for 6-digit code (or backup) — `TrustedDevice` cookie skips this for 90 days.
4. Recovery: any backup code consumes itself and lets login through. Used codes are removed from the array.

**Brute-force protection**

- 5 attempts per 5 minutes per user (Redis counter) — then lock for 15 min.
- Backup codes: 3 attempts per 24h.

**Compliance**

- Required for ADMIN, FINANCE, MODERATOR roles (enforced at login).
- Optional but encouraged for regular users.

---

### F-USER-10 — Password reset (unified across all surfaces)

**Schema** (Bet already has a half-implemented version; unify on backend)

```prisma
model PasswordReset {
  id        String   @id @default(cuid())
  userId    String
  // Hash of the reset token sent in the email — never store plaintext
  tokenHash String   @unique
  expiresAt DateTime                          // 30 min
  usedAt    DateTime?
  requestedIp String?
  user      User     @relation(fields: [userId], references: [id])
  createdAt DateTime @default(now())
  @@index([userId, usedAt])
}
```

**Flow**

1. `POST /auth/password-reset/request { email }` — always returns 200 (no email enumeration).
2. If user exists, generate `crypto.randomBytes(32)` token, hash it, store, email the plaintext.
3. User opens `/auth/password-reset/confirm?token=…` → form for new password.
4. `POST /auth/password-reset/confirm { token, newPassword }` — verify hash matches, not expired, not used → update `User.passwordHash`, mark `usedAt`, invalidate all sessions for user (next JWT verify fails).

**Abuse prevention**

- 3 requests per email per hour.
- 5 requests per IP per hour.
- Token expires in 30 min, single use.
- Inform-on-use: when token is consumed, notify the user via the OTHER channel (push if email was used to reset, etc.).

**Session invalidation**: store `User.passwordChangedAt`; JWT payload includes `iat`; verify checks `iat >= passwordChangedAt`.

---

### F-USER-11 — Email change flow

**Schema**

```prisma
model EmailChangeRequest {
  id        String   @id @default(cuid())
  userId    String
  oldEmail  String
  newEmail  String
  // Two tokens — one sent to old, one to new — both must be clicked
  oldTokenHash String  @unique
  newTokenHash String  @unique
  oldConfirmedAt DateTime?
  newConfirmedAt DateTime?
  expiresAt DateTime                          // 24h
  // Effective when both confirmed
  appliedAt DateTime?
  user      User     @relation(fields: [userId], references: [id])
  createdAt DateTime @default(now())
  @@index([userId])
}
```

**Flow**

1. User submits new email in profile settings → backend creates request, sends both emails.
2. User clicks both links within 24h → backend swaps `User.email`, writes audit log, **invalidates all sessions** (forces re-login on every device).
3. Old email gets a notification: "Your email was changed — if not you, click here to revert within 7 days."

**Rollback**

- 7-day grace window where old email can revert via `EmailChangeRevocation` table.
- Audit log keeps both old and new emails forever.

---

### F-USER-12 — Account deletion + GDPR/DPDP export

**Schema**

```prisma
model AccountDeletion {
  id         String   @id @default(cuid())
  userId     String   @unique
  // Reason captured for compliance + retention analytics
  reason     String?
  requestedAt DateTime @default(now())
  // 30-day cooling-off window
  effectiveAt DateTime
  cancelledAt DateTime?
  // The actual purge job runs at effectiveAt
  purgedAt    DateTime?
  user       User     @relation(fields: [userId], references: [id])
}

model DataExportRequest {
  id         String   @id @default(cuid())
  userId     String
  // S3 key for the generated archive
  fileKey    String?
  expiresAt  DateTime
  status     ExportStatus
  user       User     @relation(fields: [userId], references: [id])
  createdAt  DateTime @default(now())
  @@index([userId, status])
}
```

**Deletion flow**

1. User requests deletion in settings → re-auth with password + 2FA if enabled.
2. Refund-pending check: if wallet balance > 0, prompt to withdraw first OR donate to charity (admin-configurable beneficiary).
3. Open positions check: if any prediction-market open positions, prompt to close OR forfeit.
4. Open auctions check: if winning any auction, must wait for fulfillment.
5. Once cleared, account marked deleted-pending with `effectiveAt = now() + 30 days`. User is logged out everywhere, can't sign in.
6. 30 days later: purge job runs — anonymises the User row (email/username/displayName → `deleted-{userId-hash}@example.invalid`), retains transaction history (legal requirement: 7 years for financial), deletes PII (avatar, address, KYC docs).

**Export flow**

1. User requests data export → request queued.
2. Worker generates a zip with: profile JSON, all transactions CSV, all bids CSV, all orders CSV, KYC documents (the originals), audit log entries.
3. Stored in S3 with 7-day signed URL.
4. User downloads, archive auto-deletes.

**Legal retention**

- Financial transactions: 7 years (DPDP Section 8 / RBI guidelines).
- Tax-related: 7 years.
- General user data: deleted at effectiveAt + 30 days grace.
- Audit log: 7 years.

---

### F-USER-13 — KYC tiering

**Schema** (in Foundation PR — see `KycVerification`)

```prisma
model KycVerification {
  id          String   @id @default(cuid())
  userId      String   @unique
  tier        KycTier  @default(TIER_0)
  // Verification stages
  emailVerifiedAt DateTime?
  phoneVerifiedAt DateTime?
  identityVerifiedAt DateTime?
  addressVerifiedAt DateTime?
  // Documents — references to encrypted S3 objects
  documents   KycDocument[]
  // Latest review state
  reviewState ReviewState @default(NONE)
  reviewedBy  String?
  reviewedAt  DateTime?
  reviewNotes String?
  user        User       @relation(fields: [userId], references: [id])
  updatedAt   DateTime   @updatedAt
  createdAt   DateTime   @default(now())
}

enum KycTier {
  TIER_0   // Just email
  TIER_1   // Phone + email verified
  TIER_2   // Govt ID verified (PAN or Aadhaar last-4)
  TIER_3   // Address proof + selfie liveness check
}

enum ReviewState {
  NONE
  PENDING
  APPROVED
  REJECTED
  REQUIRES_RESUBMIT
}

model KycDocument {
  id          String   @id @default(cuid())
  kycId       String
  kind        DocumentKind                    // PAN, AADHAAR, PASSPORT, ADDRESS_PROOF, SELFIE
  // S3 key in the encrypted sensitive bucket
  fileKey     String
  fileSizeBytes Int
  mimeType    String
  // Virus scan + OCR results
  virusScanStatus ScanStatus
  ocrText     String?                         // extracted text, used for name match
  // Review
  reviewState ReviewState  @default(PENDING)
  reviewerId  String?
  reviewNotes String?
  // Encryption metadata
  encryptionKeyVersion Int  @default(1)
  kyc         KycVerification @relation(fields: [kycId], references: [id], onDelete: Cascade)
  createdAt   DateTime @default(now())
  @@index([kycId, kind])
}

enum DocumentKind { PAN AADHAAR_LAST4 PASSPORT VOTER_ID ADDRESS_PROOF SELFIE LIVENESS_VIDEO }
enum ScanStatus { PENDING CLEAN INFECTED ERROR }
```

**Tier policy** (configurable via `SystemSetting.kyc.*`)

| Tier | Daily withdraw cap (coins) | Monthly cap | Bet limit | What's required |
|---|---|---|---|---|
| TIER_0 | 0 (no withdraw) | 0 | 1000/day | Sign-up only |
| TIER_1 | 5,000 | 50,000 | 5,000/day | Email + phone verified |
| TIER_2 | 50,000 | 500,000 | 50,000/day | PAN or Aadhaar (last 4) + name match |
| TIER_3 | 500,000 | 5,000,000 | Unlimited | All of TIER_2 + address proof + liveness selfie |

**Document submission**

- User uploads → backend writes to encrypted bucket, queues virus scan + OCR.
- If clean + OCR name matches `User.legalName` (added to schema), auto-promote tier where eligible.
- If mismatch or low confidence, route to manual review queue.

**Manual review** (admin)

- Queue paginated by oldest first.
- Side-by-side: user-supplied details vs OCR-extracted, plus document image.
- Approve / Reject (with reason) / Request re-submit.
- Every decision writes an `AdminAuditLog` row + sends a user notification.

**Compliance**

- Documents encrypted at rest with KMS, never logged.
- Access requires `FINANCE` or `MODERATOR` role + audit log entry on every view.
- 7-year retention, then auto-delete (DPDP requirement).
- DPI registration required if we ever process Aadhaar full numbers (we only store last 4 → no DPI).

**Withdrawals gate**: every withdraw POST checks `KycVerification.tier` against the user's pending-day total. Exceeds tier? Block with a "upgrade your KYC" CTA.

---

### F-USER-14 — Responsible gambling controls

**Schema** (in Foundation PR — see `ResponsibleGamblingProfile`)

```prisma
model ResponsibleGamblingProfile {
  userId        String   @id
  // Hard limits — server enforces these on every deposit/bet
  dailyDepositLimitCoins  Int?
  weeklyDepositLimitCoins Int?
  monthlyDepositLimitCoins Int?
  dailyLossLimitCoins     Int?
  weeklyLossLimitCoins    Int?
  monthlyLossLimitCoins   Int?
  // Wagering — coins put at risk, before win/loss
  dailyWagerLimitCoins   Int?
  // Session reminders
  sessionReminderMinutes Int      @default(30)
  // Cooldown / self-exclusion — both block all betting + depositing
  cooldownUntil          DateTime?
  selfExcludedUntil      DateTime?  // perpetual = null + selfExcludedAt set
  selfExcludedAt         DateTime?
  user                   User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  updatedAt              DateTime @updatedAt
  createdAt              DateTime @default(now())
}

model ResponsibleGamblingEvent {
  id          String   @id @default(cuid())
  userId      String
  kind        RgEventKind
  // What was tried + what limit was hit
  amount      Int?
  limitKind   String?                          // "daily_deposit", "weekly_loss"
  limitValue  Int?
  // For session reminders — the duration the session had run
  sessionDurationMs Int?
  user        User     @relation(fields: [userId], references: [id])
  createdAt   DateTime @default(now())
  @@index([userId, createdAt])
}

enum RgEventKind {
  DEPOSIT_BLOCKED_BY_LIMIT
  BET_BLOCKED_BY_LIMIT
  LOSS_LIMIT_REACHED
  SESSION_REMINDER_SHOWN
  COOLDOWN_STARTED
  COOLDOWN_ENDED
  SELF_EXCLUSION_STARTED
  SELF_EXCLUSION_ENDED
}
```

**Enforcement**

- Bet placement → middleware checks `aggregateBetsToday(userId) + thisBet <= dailyWagerLimit`. Block with `RG_LIMIT_REACHED` error if over.
- Deposit (Razorpay) → same check pre-order-creation.
- Self-exclusion blocks login entirely (auth middleware checks `selfExcludedUntil > now()` or `selfExcludedAt is set with null until` for perpetual).

**Cool-down semantics**

- 24h, 7d, 30d, 90d options.
- Setting a cool-down is immediate. Cancelling requires the cool-down to expire (no early termination — regulatory).
- Self-exclusion is the same but the user must re-confirm via email AND a "are you sure" CTA shown 24h apart for permanent.

**Session reminders**

- WebSocket-driven: backend tracks `session.startedAt` on every aviator/bet round play. When `now - startedAt > reminderMinutes`, push an in-app modal "You've been playing for 30 min — take a break?".

**Compliance log**

- Every limit-block written to `ResponsibleGamblingEvent` for audit.
- Reports per user available to admins (and to the user themselves, on demand).

**UX considerations**

- Limit-reached UX: don't show "try again later", show "You've reached your daily loss limit. The next reset is in 4h 12m." with a link to RG settings.
- Setting limits down is immediate; up requires a 24h delay (regulatory).

---

### F-USER-15 — In-app live chat support / ticket system

**Schema** (in Foundation PR — see `SupportTicket`, `SupportMessage`)

```prisma
model SupportTicket {
  id          String   @id @default(cuid())
  userId      String
  subject     String
  status      TicketStatus @default(OPEN)
  priority    TicketPriority @default(NORMAL)
  // Category for routing
  category    TicketCategory
  // SLA — first-response SLA depends on category
  slaDueAt    DateTime
  firstResponseAt DateTime?
  // Linked entities for context (auction in dispute, withdrawal in question, etc.)
  linkedEntityType String?
  linkedEntityId   String?
  assignedToId String?
  closedAt    DateTime?
  closedReason TicketCloseReason?
  user        User     @relation(fields: [userId], references: [id])
  assignedTo  User?    @relation("AssignedTickets", fields: [assignedToId], references: [id])
  messages    SupportMessage[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([status, slaDueAt])
  @@index([assignedToId, status])
  @@index([userId, createdAt])
}

model SupportMessage {
  id         String   @id @default(cuid())
  ticketId   String
  senderId   String                            // user or admin
  isFromAdmin Boolean
  body       String                            // markdown allowed, HTML sanitised
  attachments SupportAttachment[]
  // Internal notes — only admins see
  isInternal Boolean  @default(false)
  ticket     SupportTicket @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  sender     User     @relation(fields: [senderId], references: [id])
  createdAt  DateTime @default(now())
  @@index([ticketId, createdAt])
}

model SupportAttachment {
  id         String   @id @default(cuid())
  messageId  String
  fileKey    String                            // S3 key
  fileName   String
  fileSizeBytes Int
  mimeType   String
  virusScanStatus ScanStatus
  message    SupportMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)
}

enum TicketStatus { OPEN AWAITING_USER AWAITING_ADMIN ESCALATED RESOLVED CLOSED }
enum TicketPriority { LOW NORMAL HIGH URGENT }
enum TicketCategory { ACCOUNT WITHDRAWAL DEPOSIT BIDDING AVIATOR ORDER_FULFILLMENT TECHNICAL OTHER }
enum TicketCloseReason { RESOLVED DUPLICATE INVALID NO_RESPONSE }
```

**SLA defaults** (configurable):

- WITHDRAWAL → 4h first response
- BIDDING / AVIATOR → 8h
- ORDER_FULFILLMENT → 12h
- ACCOUNT / TECHNICAL → 24h

**Escalation**: ticket past SLA + 50% → auto-priority bump. Past SLA + 100% → escalate to admin role channel.

**WebSocket**: real-time message updates via `tickets:user:{userId}` and `tickets:admin` channels.

---

### F-USER-16 — Push notifications infrastructure

Covered by §1A — same plumbing serves all push needs. The first specific event live is `auction_outbid_v1` (F-USER-1).

---

## Part 3 — Admin-side features (11)

### F-ADMIN-1 — Auction analytics dashboard

**Tables consumed**: existing `Auction`, `Bid`, plus new `AnalyticsAuctionSnapshot` materialised hourly.

```prisma
model AnalyticsAuctionSnapshot {
  id        String   @id @default(cuid())
  auctionId String
  snapshotAt DateTime
  bidCount  Int
  uniqueBidders Int
  revenueCoins  Int                            // sum of coinsPerBid * bidCount
  // For real-time charts
  uniqueBiddersTrailing24h Int
  auction   Auction  @relation(fields: [auctionId], references: [id], onDelete: Cascade)
  @@unique([auctionId, snapshotAt])
  @@index([snapshotAt])
}
```

**Dashboard widgets**

- Revenue YTD (all auctions, all winners).
- Time-to-close histogram (LIVE → ENDED duration).
- Conversion funnel: page view → bid → win.
- Top bidders this month (with link to user detail).
- Real-time bidding velocity (last 5/15/60 min).

**Export**: every widget can dump CSV.

**Refresh**: snapshot job every hour, on-demand refresh via admin button.

---

### F-ADMIN-2 — User search → ban/unban/impersonate

**Schema additions to User**: `bannedAt DateTime?`, `bannedReason String?`, `bannedBy String?`.

**Search**: Postgres trigram + tsvector index on `(email, username, displayName)`. Future: MeiliSearch if volume grows.

**Impersonation**

- Admin selects "Impersonate" on a user → backend issues a short-lived (10 min) impersonation JWT with extra claims: `sub=adminId, impersonating=userId, impersonationId=X`.
- Every request during impersonation writes to `ImpersonationLog`.
- User sees a server-rendered banner: "Admin is currently viewing your session." (Not strictly possible to display to the real user since it's a different session, but logged for audit.)
- All admins notified when one of their own initiates impersonation (Slack hook).

```prisma
model ImpersonationLog {
  id          String   @id @default(cuid())
  adminId     String
  userId      String
  startedAt   DateTime @default(now())
  endedAt     DateTime?
  reason      String                            // required, free-text
  // What actions did the admin take during impersonation?
  actions     Json[]                            // array of {action, target, at}
  admin       User     @relation("ImpersonatorAdmin", fields: [adminId], references: [id])
  user        User     @relation("ImpersonatedUser", fields: [userId], references: [id])
  @@index([adminId, startedAt])
  @@index([userId, startedAt])
}
```

**Ban semantics**

- `bannedAt` set → user blocked from login.
- Active wallet balance is not auto-forfeited (regulatory: customer's money). Admin can manually withdraw to source on ban.

---

### F-ADMIN-3 — Audit log of admin actions

Covered by §1C (Foundation PR) — the UI is a separate PR (`PR-ADMIN-AUDIT-1`):

- Search: by actor, target, action, date range.
- Filter: by IP range, by correlation ID.
- Export to CSV (signed URL, 1h TTL).
- "Replay" feature: view the diff between before/after for any action.
- Read-only — admin can't edit or delete audit entries.

---

### F-ADMIN-4 — Withdrawal approval queue

**Existing**: Bet has the schema (`WithdrawalRequest`). Missing: admin UI workflow.

**State machine**

```
PENDING
  ├──► APPROVED ──► PROCESSING ──► PAID
  │                              ↘ FAILED → PENDING (retry)
  └──► REJECTED → REFUNDED (auto)
```

**Multi-step review** (configurable):

- Tier 1 reviewer (any FINANCE): triages, sets initial recommendation
- Tier 2 reviewer (admin or senior FINANCE): final decision on amounts > 50,000 coins

**AML flags** (auto-set by `WithdrawalRiskService` at creation time):

- Total withdrawals this month > 200,000 coins → `LARGE_VOLUME`
- New account (< 7 days) → `NEW_ACCOUNT`
- KYC tier mismatch (Tier 1 withdrawing 100k) → `TIER_MISMATCH`
- Same UPI/bank used by another flagged user → `SHARED_PAYMENT_METHOD`
- Rapid deposit + withdraw (within 1h) → `RAPID_TURNAROUND` (potential money laundering)

Flagged requests can't be auto-approved — require explicit reviewer note acknowledging the flag.

---

### F-ADMIN-5 — Bulk image upload + drag reorder

**Existing**: single-image upload in admin.

**New**: drag-and-drop multi-file upload to ImageManager → all queued through the image pipeline (§1H) → admin reorders via drag-handles → save persists `imageUrls` array order.

**Compression pipeline**

- Original → resize to 1600×1600 max (preserve aspect)
- Generate WebP + JPEG variants at 1600, 800, 400
- Strip EXIF (privacy + smaller files)
- Quality target: SSIM ≥ 0.95
- Lazy-loaded on the frontend via `next/image` with all variants in `srcset`

---

### F-ADMIN-6 — Moderator role

Covered by §1D. Specific moderator permissions:

- View all user data (read-only)
- Edit user `displayName` and `avatarKey` (moderation)
- Ban / unban users (only with reason ≥ 50 chars)
- Cannot: change wallet balances, edit auctions, approve withdrawals, manage settings

Granular permissions defined in `backend/src/admin/permissions.ts`:

```ts
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN: ['*'],
  FINANCE: ['withdrawal.approve', 'withdrawal.reject', 'ledger.view', 'ledger.export', 'reconciliation.view'],
  MODERATOR: ['user.view', 'user.ban', 'user.unban', 'user.edit_display_name', 'user.edit_avatar', 'audit.view'],
  SUPPORT: ['ticket.view', 'ticket.reply', 'user.view'],
  AUDITOR: ['*.view', 'audit.view', 'reconciliation.view'],
};
```

---

### F-ADMIN-7 — CSV / accounting export of wallet ledger

**Format**: double-entry accounting friendly, one row per transaction with credit + debit accounts.

```csv
TxnId,Date,Time(UTC),Date(IST),UserId,Username,Amount(Coins),Amount(INR),Type,RefType,RefId,DebitAccount,CreditAccount,Description
abc123,2026-04-12,14:33:01,2026-04-12 20:03:01,user-7f2a,demo1,-100,−100.00,WITHDRAWAL_LOCK,Withdrawal,wd-xyz,user_wallet_demo1,withdrawal_holding,Withdrawal request submitted
```

**Filters**: date range, user IDs, transaction kinds, amount range, role of operator (which admin did approvals).

**Signed URL**: download link valid for 1h, audited (the admin who requested it is logged on every download).

---

### F-ADMIN-8 — Fraud watch dashboard

Detector rules running on a `fraud_scoring` BullMQ job (every 5 min):

- **Rapid bid spam**: > 30 bids in 60s by one user on one auction → flag.
- **Wallet anomaly**: deposit + withdraw within 1h with no betting/auction activity → flag (laundering pattern).
- **Multi-account heuristics**: shared device hash, shared payment method, shared IP /24 within 24h → flag pair.
- **Collusion graph**: build a graph of users who bid against each other; abnormal density (e.g. 3 users always playing the same auctions) → flag cluster.
- **Suspicious referrals**: same device hash referrer + referee → already auto-VOID (F-USER-4), surfaced here for review.

```prisma
model FraudAlert {
  id        String   @id @default(cuid())
  kind      FraudAlertKind
  severity  Severity                            // LOW MEDIUM HIGH CRITICAL
  // Affected users — array because some alerts span multiple accounts
  userIds   String[]
  // The triggering event evidence
  evidence  Json
  status    FraudAlertStatus
  // Reviewer decisions
  reviewerId String?
  reviewedAt DateTime?
  reviewNotes String?
  // Action taken
  actionTaken FraudAction?
  createdAt DateTime @default(now())
  @@index([status, severity, createdAt])
}

enum FraudAlertKind {
  RAPID_BID_SPAM
  WALLET_ANOMALY
  MULTI_ACCOUNT
  COLLUSION
  RAPID_DEPOSIT_WITHDRAW
  SUSPICIOUS_REFERRAL
}

enum FraudAlertStatus { OPEN INVESTIGATING DISMISSED ACTIONED }
enum Severity { LOW MEDIUM HIGH CRITICAL }
enum FraudAction { NO_ACTION WARN_USER LIMIT_USER BAN_USER REQUIRE_KYC_REVIEW REPORT_TO_AUTHORITIES }
```

**Alerts**: HIGH and CRITICAL severity trigger a Slack notification to a fraud-watch channel.

---

### F-ADMIN-9 — Reconciliation reports

Daily cron at 00:05 UTC compares `CoinTransaction` totals against Bet's wallet ledger sums.

```prisma
model ReconciliationReport {
  id        String   @id @default(cuid())
  runDate   DateTime
  // Aggregates per source
  localDelta  Int                              // sum of CoinTransaction.delta for the day
  betLedgerDelta Int                           // sum from Bet's API
  driftCoins  Int                              // localDelta - betLedgerDelta (zero = clean)
  // Per-user discrepancies, capped at 100 worst offenders
  topDrifts Json
  // Auto-repair suggestions (if any)
  repairSuggestions Json
  status    ReportStatus
  reviewedBy String?
  reviewedAt DateTime?
  reviewNotes String?
  createdAt DateTime @default(now())
  @@index([runDate])
}

enum ReportStatus { GENERATED REVIEWED REPAIRED }
```

If `driftCoins != 0`, alert finance team. Common drift causes: dropped Outbox message, manual SQL on either side, race condition in webhook handler. The report includes proposed compensating writes.

---

### F-ADMIN-10 — Notification campaign tool

```prisma
model NotificationCampaign {
  id          String   @id @default(cuid())
  name        String
  templateCode String                          // references NotificationTemplate
  // Audience filter — Prisma-style where clause stored as JSON
  audienceFilter Json
  // Schedule
  scheduledFor DateTime?                       // null = send now
  scheduledTimezone String?                    // IANA, for cron-like recurring
  // Rate
  sendRatePerMinute Int @default(1000)
  // Status
  status      CampaignStatus
  estimatedAudience Int?
  // Metrics — populated as messages send
  sentCount     Int  @default(0)
  deliveredCount Int @default(0)
  readCount     Int  @default(0)
  clickCount    Int  @default(0)
  // Audit
  createdBy   String
  approvedBy  String?
  approvedAt  DateTime?
  campaign    User    @relation("CampaignCreator", fields: [createdBy], references: [id])
  createdAt   DateTime @default(now())
}

enum CampaignStatus { DRAFT PENDING_APPROVAL APPROVED RUNNING PAUSED COMPLETED CANCELLED FAILED }
```

**Approval**: any campaign with audience > 1000 requires a second admin to approve.

**Targeting examples**:
- All Tier-2+ KYC users who haven't logged in in 14 days
- All winning bidders in the last 30 days
- All users with > 50,000 coins balance

**Tracking**: every notification carries a `campaignId` so opens/clicks are attributable.

---

### F-ADMIN-11 — Runtime settings UI

Covered by §1F — separate UI PR.

**Page**: `/admin/settings`. Grouped editor: Wallet, Aviator, Auctions, Referrals, KYC, RG.

**Each row**: key, current value, type, description, "edit" → modal with validation (numeric range, JSON schema, enum picker, etc.) → "save" requires confirmation modal showing diff and prompts for change reason (logged).

**Versioning**: side panel shows `SystemSettingHistory` — every change with timestamp, actor, before/after, reason.

**Safe rollout**: critical settings (wallet.withdraw_min_coins, KYC tier limits) require two admins to approve before going live. Setting carries a `pendingValue` field; second admin confirms.

---

## Part 4 — PR-sized execution roadmap

### PR dependency graph

```
                                       Foundation PR (shipped here)
                                              │
        ┌─────────────────┬───────────────────┼──────────────────┬────────────────┐
        ▼                 ▼                   ▼                  ▼                ▼
   PR-NOTIFY-1       PR-OUTBOX-1         PR-AUDIT-1        PR-RBAC-1       PR-SETTINGS-1
   (FCM push wired,  (worker live for   (admin audit UI)   (role grants UI) (settings UI)
   one event live)   bid → wallet)
        │                 │                   │                  │                ↓
        ├────────────┐    ├─────┐             ↓                  │            PR-AVIATOR-RT-CFG
   PR-WATCHLIST-1   PR-NOTIFY-2 │       PR-IMPERSONATE-1     PR-MODERATOR-1   (move env→settings)
   (outbid)         (all events) │       (admin impersonate) (mod role wired)
                                 │              │
                              PR-RECON-1   PR-FRAUD-1
                              (daily recon job) (rules + dashboard)
                                              │
                                          PR-FRAUD-2
                                          (collusion graph)

   ─── Independent tracks (can land any time post-Foundation) ───

   PR-PROFILE-1 (avatar + display name)
   PR-PROFILE-2 (moderation queue)
   PR-ADDRESS-1 (shipping addresses)
   PR-ORDER-1   (order tracking)
   PR-DAILY-1   (login streak)
   PR-2FA-1     (TOTP)
   PR-2FA-2     (backup codes + trusted device)
   PR-PWRESET-1 (password reset unified)
   PR-EMAIL-1   (email change)
   PR-DELETION-1 (account delete + GDPR export)
   PR-KYC-1     (tier system + document upload)
   PR-KYC-2     (admin review queue)
   PR-RG-1      (RG limits + enforcement)
   PR-RG-2      (self-exclusion + session reminders)
   PR-TICKETS-1 (support ticket system)
   PR-CSV-1     (trade history export)
   PR-CSV-2     (wallet ledger export, admin-side)
   PR-SHARE-1   (position sharing + OG image)
   PR-REFERRAL-1 (claim + qualify flow)
   PR-REFERRAL-2 (admin fraud controls)
   PR-ANALYTICS-1 (auction analytics dashboard)
   PR-BULK-IMG-1 (bulk image upload)
   PR-CAMPAIGN-1 (notification campaigns)
```

### Recommended sequencing (one engineer, 4 months)

**Month 1** — Foundation + auth + roles
- Week 1: Foundation PR (this one). Verify in prod.
- Week 2: PR-NOTIFY-1 (FCM push, outbid event). Canary 5% → 100%.
- Week 3: PR-OUTBOX-1, PR-AUDIT-1. Reconcile pile-up alerts go live.
- Week 4: PR-RBAC-1, PR-MODERATOR-1, PR-SETTINGS-1.

**Month 2** — Compliance + responsible features
- Week 5-6: PR-KYC-1, PR-KYC-2. Tier system blocking withdrawals.
- Week 7: PR-RG-1, PR-RG-2. Limits + self-exclusion.
- Week 8: PR-2FA-1, PR-2FA-2, PR-PWRESET-1.

**Month 3** — User engagement
- Week 9: PR-WATCHLIST-1, PR-NOTIFY-2.
- Week 10: PR-PROFILE-1, PR-PROFILE-2.
- Week 11: PR-DAILY-1, PR-REFERRAL-1.
- Week 12: PR-ADDRESS-1, PR-ORDER-1.

**Month 4** — Trust + admin tooling + extras
- Week 13: PR-TICKETS-1.
- Week 14: PR-RECON-1, PR-FRAUD-1.
- Week 15: PR-CSV-1, PR-CSV-2, PR-SHARE-1.
- Week 16: PR-ANALYTICS-1, PR-CAMPAIGN-1, PR-EMAIL-1, PR-DELETION-1.

**Quarter 2** — fraud iteration, optimizations, scale-out
- PR-FRAUD-2 (collusion graph)
- PR-IMPERSONATE-1
- PR-BULK-IMG-1
- Move workers to separate `kalki-worker` deployment if queue depth justifies

### Feature flags (per PR)

Every business-feature PR ships behind a default-off flag:

| Flag | Default |
|---|---|
| `notifications.enabled` | false |
| `watchlist.enabled` | false |
| `2fa.enabled` | false |
| `kyc.tier_enforcement` | false |
| `rg.limits_enforced` | false |
| `referral.claims_enabled` | false |
| `daily_streak.enabled` | false |
| `account_deletion.enabled` | false |
| `position_sharing.enabled` | false |
| `tickets.enabled` | false |
| `fraud.alerts_enabled` | false |

Flip flags via admin Settings UI. Rollback = flip flag.

---

## Part 5 — Infrastructure upgrades

### 5.1 Redis upgrade (BullMQ + cluster)

**Current**: external Redis from `kalkai` namespace (single instance, no persistence visible).

**Required for**:

- BullMQ workers (notifications, outbox, exports, jobs)
- Idempotency cache (24h TTL)
- Feature flag cache (10s TTL)
- Session-reminder timers (RG)
- Fraud rule sliding windows (5-min)

**Upgrade**:

- Enable RDB + AOF persistence
- Bump from `requests: 100m / limits: 1G` to `requests: 500m / limits: 4G`
- If queue throughput exceeds 5k jobs/min, deploy Redis Cluster (3 master + 3 replica) — but stay single-instance until then

### 5.2 FCM / APNS

- Create Firebase project `kalki-prod`.
- Server key in `kalki-secrets` (sealed-secret in cluster).
- iOS: APNS p8 key in same secret.
- Sandbox APNS for staging.

### 5.3 SES / SendGrid

- Verify `noreply@kalki.cloud.podstack.ai` domain.
- DKIM + SPF + DMARC records.
- Bounce + complaint handler webhook → backend.

### 5.4 S3 buckets

- `kalki-public` — auction images, avatars (CDN-fronted, public read)
- `kalki-sensitive` — KYC docs, ticket attachments (private, KMS-encrypted)
- `kalki-exports` — user data exports, ledger exports (private, 7d lifecycle)
- `kalki-archives` — audit log cold storage (7y lifecycle, Glacier)

### 5.5 KMS

- One CMK per bucket category.
- IAM policy: backend pod role can `kms:Decrypt + Encrypt` on `kalki-sensitive` CMK only.
- Rotation: annual automatic.

### 5.6 Image processor

- `sharp` + `clamav` sidecar pod for KYC + avatar pipelines.
- ClamAV signature update daily.

### 5.7 Logging + observability

- Structured JSON logs via `pino` (already in NestJS).
- Correlation ID middleware on every request.
- Loki + Grafana for log aggregation (deploy alongside existing kalkai infra).
- Prometheus metrics: BullMQ queue depth, FCM delivery rate, KYC review queue depth, withdraw approval latency.

### 5.8 Backup strategy (database)

- Daily pg_dump → S3 with 35-day retention.
- WAL archiving → S3 every 5 min.
- Test restore quarterly into a staging environment.

---

## Part 6 — Monitoring & alerting

### Page-on-call alerts (PagerDuty / Slack #oncall)

- Outbox `DEAD` rows > 0 → page
- Outbox `PENDING` > 1000 → warn
- BullMQ queue depth on any queue > 10k → warn
- Daily reconciliation `driftCoins != 0` → page (finance on-call)
- HIGH/CRITICAL `FraudAlert` opened → page (fraud team)
- KYC review queue depth > 200 → page (KYC team)
- WithdrawalRequest pending > 24h → page
- Database write latency p99 > 500ms → warn
- API error rate > 1% over 5 min → page
- Razorpay verification failure rate > 5% → page
- FCM permanent failure rate > 10% → warn

### Dashboards (Grafana)

- **Revenue / Wallet** — coins in/out, per-day, per-channel
- **Aviator** — rounds per hour, avg multiplier, crash distribution, cashout rate
- **Auctions** — concurrent live, bid volume, time-to-close p50/p95
- **Notifications** — queue depths, delivery success per channel, dead-letter count
- **KYC** — submissions per day, time-to-decision p50/p95
- **Fraud** — alerts per kind, false-positive rate (from reviewer dismissals)

---

## Part 7 — Security audits & compliance checkpoints

### Pre-launch security audit (Q3 2026)

External pen-test focused on:
- Auth + session handling
- Payment + withdrawal flows
- Bid race conditions + replay attacks
- KYC document storage
- Admin impersonation abuse
- WebSocket auth + message tampering

### Compliance checkpoints

**Before opening to general public (Phase 1)**:
- KYC tiering live (F-USER-13)
- Responsible gambling enforced (F-USER-14)
- Audit log live (F-ADMIN-3)
- Withdrawal multi-step approval live (F-ADMIN-4)
- Reconciliation reports green for 30 consecutive days (F-ADMIN-9)
- Data deletion request flow live (F-USER-12)
- 2FA available (F-USER-9)

**Before international expansion (Phase 2)**:
- GDPR-compliant export flow (F-USER-12)
- Self-exclusion register (regulatory in EU/UK)
- Geo-blocking for forbidden jurisdictions
- Local language + currency support
- Locale-aware notifications

**Quarterly**:
- Backup restore drill
- Pen-test re-run
- Audit log integrity check (random sampling)
- Wallet reconciliation manual audit
- Privacy policy + terms review

### India-specific (DPDP Act + RBI guidelines)

- Data Protection Officer appointed before processing > 100k user records
- KYC documents encrypted at rest, access logged
- 7-year retention on financial transactions
- Aadhaar full numbers NOT stored (only last 4); UIDAI registration not required
- Customer-grievance redress mechanism (covered by ticket system F-USER-15)
- Annual data audit report

---

## Open architecture questions (resolve before scheduling specific PRs)

These are intentionally NOT decided in this document — the team should make these calls before scheduling the relevant PR:

1. **FCM vs OneSignal vs custom**. OneSignal handles iOS+Android+Web+email in one SDK, lower implementation cost, but vendor lock-in and unit economics worse at scale. Recommend: FCM directly for push, SES directly for email — full control + cheaper.
2. **Self-hosted ClamAV vs cloud (AWS Macie / GuardDuty)**. Macie/GuardDuty surface PII detection too, but cost scales with data volume. Self-hosted ClamAV is fine for our volume.
3. **MeiliSearch for user search**. Postgres trigram is enough at < 1M users; revisit at 5M.
4. **Hot vs cold KYC document storage**. We could route old (> 1y) docs to Glacier. But review-reopen latency goes from instant to hours. Recommend hot until we have a year of data.
5. **Aadhaar last-4 only vs full**. Full Aadhaar requires UIDAI registration + much higher compliance burden. Recommend last-4-only.
6. **In-app notification persistence**. Forever? 90 days? Recommend 90 days, archive to user-export feature if requested.

---

## Appendix A — Environment variables affected

New env vars introduced by this work:

| Var | Used by | Default |
|---|---|---|
| `REDIS_URL` | BullMQ | (existing) |
| `FCM_SERVER_KEY` | push delivery | none — required for prod |
| `APNS_KEY_ID` + `APNS_TEAM_ID` + `APNS_PRIVATE_KEY` | iOS push | none |
| `SES_REGION` + `SES_ACCESS_KEY` + `SES_SECRET` | email | none |
| `S3_REGION` + `S3_BUCKET_PUBLIC` + `S3_BUCKET_SENSITIVE` + `S3_BUCKET_EXPORTS` + `S3_ACCESS_KEY` + `S3_SECRET` | storage | none |
| `KMS_KEY_ID_SENSITIVE` | KYC + addresses | none |
| `CLAMAV_HOST` + `CLAMAV_PORT` | virus scanning | `localhost:3310` |
| `IDEMPOTENCY_TTL_HOURS` | idempotency cache | 24 |
| `RAZORPAY_WEBHOOK_SECRET` | webhook verify | (existing — required) |

Settings that *move* from env → SystemSetting (over time, with backward-compat fallback):

- `SIGNUP_COIN_BONUS` → `wallet.signup_bonus_coins`
- `WITHDRAW_MIN_COINS` → `wallet.withdraw_min_coins`
- `AVIATOR_MIN_BET` / `AVIATOR_MAX_BET` → `aviator.min_bet_coins` / `aviator.max_bet_coins`

---

*End of roadmap. Schema migrations and skeleton services for the items marked "in Foundation PR" land on the `claude/production-foundation` branch alongside this document.*
