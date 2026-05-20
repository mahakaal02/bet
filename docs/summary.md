# Backend Architecture Summary

**Companion to `CONTEXT.md`, `Documentation.md`, `Final.md`.**

This doc describes how the Kalki Bet backend is structured and why. Read this before you touch a module you haven't seen before.

---

## Table of contents

- [The 30-second elevator](#the-30-second-elevator)
- [Service map (every module, 1 line each)](#service-map)
- [Data flow — the big patterns](#data-flow)
- [Database — 82 models grouped by concern](#database)
- [External integrations](#external-integrations)
- [Background work — worker, outbox, crons](#background-work)
- [Key abstractions (adapters + interfaces)](#key-abstractions)
- [Observability](#observability)

---

## The 30-second elevator

NestJS + Prisma + Postgres + Redis monorepo. Single application image runs in two modes via `KALKI_ROLE`:

- **`api`** (default): HTTP listener on `:4000`, WebSocket on the same port, all `@Cron` jobs fire inline. Backwards-compatible with the legacy single-pod topology.
- **`worker`**: no HTTP listener; modules still boot, `@Cron` jobs still fire. Used to lift CPU-heavy drains (notification dispatch, outbox, recon, fraud sweep) into a dedicated pod without contending with HTTP latency.

Every cross-service side-effect (wallet debit, email send, push notification, KYC scan) is mediated by **the outbox pattern + worker drain loops**, not synchronous HTTP. The HTTP request path writes a row to the DB; a worker picks it up under `SKIP LOCKED` and ships it. This is what lets the system survive Bet wallet outages and lets us replay failed external calls without losing data.

Sensitive operations (encryption, signing, virus scanning, image processing) are **behind interfaces with adapter implementations**. The same image runs against disk + stub scanner + local-key cipher in dev/CI, and against S3 + ClamAV + KMS in prod, with no code change — just env vars (`KYC_STORAGE_DRIVER=s3`, `KYC_VIRUS_SCANNER=clamav`, `KYC_CIPHER_DRIVER=kms`).

---

## Service map

Each directory under `backend/src/` is a NestJS module. There are 30 of them.

### Foundation layer

| Module | Purpose | Key files |
|---|---|---|
| `prisma/` | DB client + `PrismaService` singleton injected everywhere. | `prisma.service.ts`, `prisma.module.ts` |
| `redis/` | Redis client wrapper. Used for rate-limit counters + soon for leader election. | `redis.service.ts` |
| `foundation/` | Audit log, feature flags, system settings, notifications-enqueue helper. **Everything depends on this.** | `audit-log.service.ts`, `feature-flag.service.ts`, `system-settings.service.ts`, `notification.service.ts` |
| `aws/` | Shared SigV4 signer used by SES + S3 + KMS. Zero AWS SDK deps. | `sigv4.ts` |

### Auth + RBAC

| Module | Purpose |
|---|---|
| `auth/` | Login (password + 2FA + trusted-device), JWT issue/validate, password reset, email change, secret cipher (local-key AES-256-GCM), TOTP (RFC 6238), trusted-device sha256 hash flow, admin cookie auth (since PR-ADMIN-COOKIE-AUTH). |
| `auth-whatsapp/` | WhatsApp-phone OTP signup path. Parallel to email/password — same `User` table, just a different login mechanism. |
| `impersonation/` | Admin "act as" with audit-logged sessions. Mints JWTs with `purpose: 'impersonation'` + `actorId`. |
| `admin/` | The 12 admin controllers — settings, feature flags, audit log, roles, reconciliation, fraud, tickets, profile moderation, etc. RBAC enforced via permission slugs (`audit.read`, `withdrawal.approve`, etc.) wired in `permissions.ts`. |

### Product domains

| Module | Purpose |
|---|---|
| `auctions/` | Auction CRUD + lifecycle + image uploads. Public read; admin write. |
| `bids/` | Bid placement, ringmaster auction settlement, outbox-driven wallet debit. The `placeBid` flow is the canonical example of the outbox pattern. |
| `coins/` | Coin economy settings + `CoinTransaction` ledger. Source of truth for "what does this user own". |
| `coin-packs/` | Coin pack catalog + admin CRUD + bulk import (PR-CSV-2). |
| `payments/` | Razorpay order creation + verify (webhook handler at `/payments/razorpay/webhook`). |
| `aviator/` | Aviator game module — crash multiplier game with provable fairness via seed-disclosure. |
| `watchlist/` | User-side watch/unwatch for auctions. Drives the `auction_outbid_v1` notification when a watcher is displaced. |
| `daily-login/` | 30-day streak + freeze-spend math. Idempotent on 26h-grace claim. |
| `addresses/` | Shipping addresses CRUD + default-selection invariants + soft delete. |
| `profile/` | Display name + avatar + reserved-name + Devanagari-friendly profanity filter (PR-PROFILE-1) + admin moderation queue for borderline names (PR-PROFILE-2). |
| `kyc/` | Tier ladder (TIER_0 → TIER_1 → TIER_2) + encrypted document pipeline behind `KycStorage` / `VirusScanner` / `DocumentCipher` adapters. Every PII view audited via `KycAdminController`. |
| `responsible-gambling/` | Deposit/loss/session limits, 24h cool-off on limit raises (PR-RG-2), self-exclusion, login gate, bet pre-flight hook. |
| `account-deletion/` | 30-day request → cancel → purge state machine + GDPR/DPDP data export bundle. |
| `referrals/` | Per-user codes + claim + KYC+deposit qualification + dual-outbox payout (referrer + referee credit). |
| `orders/` | Lifecycle state machine for physical fulfilment (PENDING → SHIPPED → DELIVERED → …). Shipping address snapshot stored at `setShippingAddress` time to decouple from later edits. |
| `tickets/` | Support ticket inbox — anti-dup-per-category, SLA timer (per-priority via SystemSetting), internal notes hidden from user. |

### Trust + admin + analytics

| Module | Purpose |
|---|---|
| `notifications/` | Multi-channel pipeline: `InappAdapter` (DB row + WebSocket broadcast), `PushAdapter` (FCM), `EmailAdapter` (SES via shared SigV4). `NotificationWorker` drains PENDING rows; `NotificationBroadcastGateway` does realtime delivery. `OutbidListenerService` fires the `auction_outbid_v1` event. `EmailWebhookController` + `EmailWebhookService` handle SES bounces/complaints; PR-NOTIFY-3 adds RSA signature verification. |
| `reconciliation/` | Nightly local-vs-Bet wallet recon. Per-user `localSum` (`CoinTransaction.sum`) vs `remoteSum` (Bet balance) → `ReconciliationDiscrepancy` rows. Idempotent on `forDate`. Admin ack workflow. |
| `fraud/` | Velocity (bid-burst per user) + cluster (shared IP/device/referrer across users) heuristics → `FraudSignal` table. Severity scales with how-far-over-threshold. PR-FRAUD-2 added bulk-ack + cluster-ban + unban admin actions. |
| `csv/` | Admin streaming exports (`CSV-1`) + bulk imports (`CSV-2`). Async-iterator-based, cursor-paginated, 1M-row safety cap. Zero-dep RFC 4180 parser. Dry-run-by-default for imports. |
| `analytics/` | Funnel (signup → email → phone → KYC ≥ TIER_1 → first deposit → first bid) + weekly cohort retention. UTC-Monday-anchored buckets. No charting lib — plain divs + tables in the admin SPA. |
| `campaigns/` | Coin-pack promo codes. PERCENT or FLAT discount. Lifetime + per-user caps. Optional CoinPack allowlist. `validate()` is pure (unauthenticated of effect on the per-user cap); `redeem()` is the side-effecting half. |
| `storage/` | Generic `Storage` interface (`put`/`get`/`delete`/`urlFor`) shared by avatars + KYC + auctions (PR-BULK-IMG-1). `SharpImageProcessor` resizes + EXIF-strips uploads. |
| `uploads/` | Multer upload directory served at `/uploads/*`. Static-asset path baked into Helm with a Longhorn PVC for durability. |
| `bet-wallet/` | HTTP client to the Bet wallet service. Used by `/auth/me` for balance overlay + by recon. Returns `null` (not `0`) when Bet is unreachable so callers can fall back to the local column. |

The full module list is in `backend/src/app.module.ts`. Every module follows the same shape: `<module>.module.ts` + `<module>.service.ts` + `<module>.controller.ts` + DTOs in `dto/` + spec files alongside.

---

## Data flow

The codebase has three recurring data-flow patterns. Internalise these and 80% of the code makes immediate sense.

### Pattern 1 — Outbox-mediated side effects

Used by: `BidsService.placeBid()`, `PaymentsService` (webhook → wallet credit), `ReferralsService` (qualification → dual payout), `AccountDeletionService` (purge → cascade).

```
HTTP request → Service writes an Outbox row (status=PENDING, kind='BET_WALLET_DEBIT') in the same tx
            → Returns 200 to the client
                ↓
            Worker pod (KALKI_ROLE=worker) every ~1.5s:
                SELECT … FROM "Outbox" WHERE status='PENDING' LIMIT 50 FOR UPDATE SKIP LOCKED
                → For each row: call the registered dispatcher (e.g. BetWalletService.debit)
                → SET status='SENT' or status='RETRY' on failure
                → Backoff: 5s → 30s → 5m → 30m → 4h → DEAD
```

**Why this matters:**
- `SKIP LOCKED` means two workers can drain in parallel without stepping on each other.
- The HTTP path is never blocked on an external service (Bet wallet, FCM, SES).
- A 30-second wallet outage costs zero user-visible failures — the outbox just retries.
- Every dispatcher is registered with a stable string key, so adding a new outbox kind is a 3-line change.

**Idempotency contract**: every dispatcher MUST be safe to call twice. Most use a dedupe key in the outbox payload (e.g. `referral:<claimId>:referrer`) which downstream services treat as their idempotency token.

### Pattern 2 — Adapter interface for swappable backends

Used by: KYC (`KycStorage`, `VirusScanner`, `DocumentCipher`), notifications (`InappAdapter`, `PushAdapter`, `EmailAdapter`), storage (generic `Storage` for avatars/KYC/auctions), Bet wallet (`BalanceFetcher`).

```
┌── interface VirusScanner ──┐
│  scan(plaintext): Result   │
└────────────────────────────┘
        ▲
        │
   ┌────┴─────┐
   │          │
StubVirus   ClamAvVirus
Scanner     Scanner
(dev/CI)    (prod, INSTREAM TCP)
```

**Module factory** picks the impl from env:
```typescript
const scannerProvider: Provider = {
  provide: VIRUS_SCANNER,
  useFactory: () => {
    const driver = process.env.KYC_VIRUS_SCANNER ?? 'stub';
    return driver === 'clamav' ? new ClamAvVirusScanner() : new StubVirusScanner();
  },
};
```

**Why this matters:**
- Dev / CI never needs LocalStack, real S3, real ClamAV, real KMS. The disk + stub + local-key trio runs the full KYC flow end-to-end in < 2s in `npx jest`.
- Prod gets the real backends by setting three env vars in the kalki-shared Secret + flipping a Helm flag.
- Tests inject mocks at the `connectFn` / `fetchImpl` / `BalanceFetcher` seam — no global mocking required.

### Pattern 3 — Snapshot-before-update

Used by: `addresses/`, `profile/`, `orders/`, `fraud/` (bans), `tickets/` (assignments).

```typescript
// WRONG — audit log captures the post-update state
const updated = await prisma.user.update({ where: { id }, data: { bannedAt: null } });
await audit.record({ before: { bannedAt: updated.bannedAt }, … }); // null!

// RIGHT — snapshot first
const before = { bannedAt: user.bannedAt?.toISOString() ?? null };
await prisma.user.update({ where: { id }, data: { bannedAt: null } });
await audit.record({ before, after: { bannedAt: null }, … });
```

**Why this exists:** Prisma's mock layer (used in unit tests) sometimes mutates the same row object in place. Even with the real Prisma client, certain configurations leak the post-update values into the `user` reference. Snapshot-before-update sidesteps the trap in every code path.

This pattern bit us five times during the program (PR-ADDRESS-1, PR-PROFILE-1, PR-ORDER-1, PR-FRAUD-2, PR-TICKETS-1) — each time the test caught it because the audit log assertion failed. **If you're updating a row and writing an audit log, snapshot first.**

---

## Database

82 schema entities total (models + enums). Grouped by concern:

### Identity + auth (~10 tables)

`User`, `DeviceToken`, `Role`, `UserRole`, `PhoneOtp`, `EmailChangeRequest`, `PasswordResetToken`, `TwoFactorBackupCode`, `TrustedDevice`, `ImpersonationLog`.

### Auction game (~6 tables)

`Auction`, `Bid`, `Watchlist`, `CoinSettings`, `CoinPack`, `CoinTransaction`.

### Aviator game (~5 tables)

`AviatorRound`, `AviatorFairnessSeed`, `AviatorBet`, `AviatorChatMessage`, `AviatorSettings`.

### Payments + economy (~3 tables)

`PaymentOrder`, `Outbox`, `RazorpayWebhookEvent` (logged for idempotency).

### Admin + governance (~8 tables)

`AdminAuditLog`, `FeatureFlag`, `SystemSetting`, `SystemSettingHistory`, `Permission`, `RolePermission`, `KycVerification`, `KycDocument`.

### Compliance + safety (~6 tables)

`RgLimit`, `RgEvent`, `SelfExclusion`, `AccountDeletionRequest`, `EmailSuppression`, `ProfileFlag`.

### Engagement + monetisation (~6 tables)

`DailyLoginStreak`, `ShippingAddress`, `Order`, `OrderItem`, `ReferralClaim`, `Notification`, `NotificationPreference`, `NotificationTemplate`, `PromoCode`, `PromoCodeRedemption`.

### Trust + admin operations (~6 tables)

`Ticket`, `TicketReply`, `ReconciliationReport`, `ReconciliationDiscrepancy`, `FraudSignal`, `FraudRule`.

### Q2 additions

`BackgroundJob` (worker heartbeats, optional), KMS envelope versioning is encoded inline in `KycDocument.encryptionKeyVersion` (no schema change needed).

**Migrations** live in `backend/prisma/migrations/`. Each PR ships its own migration directory; the convention is `<YYYYMMDD><HHMMSS>_<slug>/migration.sql`. The init container at `helm/kalki/templates/backend.yaml` runs `prisma migrate deploy` on pod boot, with self-healing cleanup of stuck `_prisma_migrations` rows (PR #27).

---

## External integrations

| System | What we use it for | How we talk to it |
|---|---|---|
| **AWS SES** | Email delivery (PR-NOTIFY-2) | Inline SigV4 via `aws/sigv4.ts` — no `@aws-sdk/*`. |
| **AWS SNS** | SES bounce/complaint webhooks (PR-NOTIFY-2 + PR-NOTIFY-3) | Inbound POST to `/webhooks/ses`; signature verified by `SnsSignatureVerifier`. |
| **AWS S3** | Encrypted KYC document storage (PR-INFRA-S3-1) | Inline SigV4; SSE-KMS for layered defence. |
| **AWS KMS** | Per-document data-encryption keys (PR-INFRA-KMS-1) | Inline SigV4 + JSON-1.1 protocol. Envelope encryption — KMS never sees the document bytes. |
| **ClamAV** | KYC document virus scanning (PR-INFRA-CLAMAV-1) | Native INSTREAM TCP — no client lib. |
| **Razorpay** | Payment gateway for coin-pack purchases | REST + webhook handler at `/payments/razorpay/webhook`. |
| **FCM** | Push notifications to mobile | Direct REST against `https://fcm.googleapis.com/`. |
| **Bet wallet** (internal) | Unified coin balance across products | HTTP client `BetWalletService`. Cross-service shared `BACKEND_JWT_SECRET`. |

**The zero-dep rule**: any "we have to talk to AWS / sign a request / parse a wire protocol" gets an inline implementation against Node's `crypto` + `fetch`. Reasoning: every external SDK is ~5–15 MB of transitive deps + a supply-chain risk surface, while the actual protocol code is usually < 100 lines. See `aws/sigv4.ts`, `kyc/virus-scanner.ts` (INSTREAM), `notifications/sns-signature-verifier.ts` (RSA verify), `auth/totp.ts` (RFC 6238) for the pattern.

---

## Background work

Two scheduling primitives:

### `@Cron` decorators

NestJS `ScheduleModule` registers every `@Cron('0 2 * * *')`-decorated method on app boot. Examples:

| Cron | When | Job |
|---|---|---|
| `NotificationWorker.drainTick` | every 1.5s | drain PENDING notifications |
| `OutboxWorker.drainTick` | every 1.5s | drain PENDING outbox rows |
| `ReconciliationService.nightlyRun` | 02:00 UTC daily | local-vs-Bet wallet reconciliation |
| `FraudService.clusterSweep` | 03:00 UTC daily | shared-IP/device/referrer detection |
| `ResponsibleGamblingService.activatePending` | every 5 min | promote pending limit raises after 24h |
| `AuctionsService.autoCloseExpired` | every 30s | close auctions whose `endsAt` passed |
| `AccountDeletionService.purgeExpired` | 04:00 UTC daily | purge accounts past their 30-day cool-off |

### Outbox

Pulls work from the DB (vs cron pulling work from time). Used for any side effect that must survive a service outage. The dispatcher registry in `notifications/notifications.service.ts` and `bet-wallet/bet-wallet.service.ts` registers handlers keyed by `OutboxKind`. Adding a new kind is:

1. Add to the `OutboxKind` enum in `schema.prisma`.
2. `prisma migrate dev`.
3. Register a dispatcher in the appropriate module's `onModuleInit`.
4. Write a `INSERT INTO "Outbox"` from the producing service.

### Topology

- **API pod** (`KALKI_ROLE=api`, default, `replicas: 1+`): HTTP + WebSocket + all `@Cron` jobs.
- **Worker pod** (`KALKI_ROLE=worker`, `replicas: 1`, `worker.enabled: true` in values.yaml): no HTTP, but `@Cron` jobs fire — drains notifications + outbox without HTTP contention. Single replica until `PR-LEADER-ELECT` ships Postgres advisory-lock or Redis SETNX leader election.

See `docs/WORKER_TOPOLOGY.md` for the detailed safety analysis of which crons are safe to run on two pods (SKIP-LOCKED-protected) and which aren't (auction settlement).

---

## Key abstractions

The codebase repeatedly uses a handful of small, well-named patterns. Knowing them by name shortcuts code review:

| Pattern | Where to find it |
|---|---|
| **Adapter + factory** | `kyc.module.ts`, `notifications.module.ts`, `storage.module.ts` — every "interface with multiple impls keyed by env var" follows the same provider shape. |
| **Loud failure** | `kyc-storage.ts::S3KycStorage.assertCreds`, `document-cipher.ts::KmsDocumentCipher.assertCreds`. If credentials are missing in a prod-driver, throw immediately rather than silently no-op. |
| **Connect-fn injection** | `virus-scanner.ts::ClamAvVirusScanner` takes a `connectFn` so tests inject a fake socket. Same pattern for `fetchImpl` in `S3KycStorage`, `KmsDocumentCipher`, `SesSender`, `SnsSignatureVerifier`. |
| **Snapshot-before-update** | See [Pattern 3 above](#pattern-3--snapshot-before-update). |
| **Version-byte envelopes** | `secret-cipher.ts`, `document-cipher.ts` both prefix ciphertext with a 1-byte version. Local cipher uses 1–99; KMS envelope uses 100. Future format bumps stay in the same column. |
| **Dual outbox** | `referrals/` writes two `BET_WALLET_CREDIT` rows with distinct dedupe keys (`referral:<id>:referrer` and `referral:<id>:referee`) in the same transaction as the qualification update. |
| **Permission slug RBAC** | `admin/permissions.ts` — instead of "Role has access X", we slot per-permission strings (`audit.read`, `withdrawal.approve`, …) and check via `@RequirePermission()`. New slugs land in the seed migration. |
| **Public + admin controller split** | Most modules have `<module>.controller.ts` (user-facing) AND `<module>-admin.controller.ts` (admin-RBAC-guarded). Same service underneath. |
| **TTL-cached foundation reads** | `feature-flag.service.ts` (10s) + `system-settings.service.ts` (60s) cache in-memory because they're read on every request. Cache invalidation = "wait at most 60s after the admin flips a flag". |

---

## Observability

- **Logging**: every service injects `Logger` from `@nestjs/common`. The log levels we actually use:
  - `error`: something is on fire; alert.
  - `warn`: degraded state; might recover.
  - `log`: notable event (cron tick, ticket assigned, bid placed).
  - `debug`: high-volume per-request stuff. Off in prod.
- **Audit log** (`AdminAuditLog`): every state-changing admin action lands here. `before` and `after` JSON columns. Snapshot-before-update is what makes `before` honest.
- **Outbox status enum**: `PENDING` / `SENT` / `RETRY` / `DEAD` lets ops `SELECT … WHERE status='DEAD'` to spot stuck jobs.
- **Feature flag toggles** are themselves audit-logged via `system-settings.service.ts`.
- **No Prometheus / OpenTelemetry yet** — kept the surface minimal during the build-out. The structured logs in JSON-line format are the migration path.

---

*End of summary. Cross-references: `Documentation.md` for "how to use", `Final.md` for "how not to break it".*
