# Project Context — engineering handoff

**As of 2026-05-22**

Snapshot of where the Kalki Bet monorepo stands after the multi-PR production-readiness program. Pick this up cold; everything you need to continue is referenced inline.

> **Sibling docs** (all in `docs/`):
> - [`AUDIT_2026-05-20.md`](AUDIT_2026-05-20.md) — backend/bet/auctions/aviator security + correctness audit findings.
> - [`PRODUCTION_ROADMAP.md`](PRODUCTION_ROADMAP.md) — the 27-feature program with PR-sized execution roadmap, infrastructure recommendations, compliance checkpoints. **The single source of truth for what's planned.**
> - This file — running snapshot of what's been built, what's pending, what to do next.

---

## Table of contents

- [Status snapshot](#status-snapshot)
- [Roadmap progress](#roadmap-progress)
- [What was built](#what-was-built)
- [Key decisions](#key-decisions)
- [File structure](#file-structure)
- [What's left to do](#whats-left-to-do)
- [How to pick this up](#how-to-pick-this-up)
- [Open architecture questions](#open-architecture-questions)

---

## Status snapshot

### Currently MERGED on `main`

| PR | Title | What it landed |
|---|---|---|
| [#18](https://github.com/mahakaal02/bet/pull/18) | Aurora redesign | Aviator: original procedural mascot ("Lumen"), Aurora design system, GameStage canvas engine |
| [#19](https://github.com/mahakaal02/bet/pull/19) | Aviator UX pass | Multiplier follows mascot, coins terminology, responsive bet button |
| [#20](https://github.com/mahakaal02/bet/pull/20) | Aviator polish | Integer-second countdown, "Crashed" copy, HUD-style multiplier chip |
| [#21](https://github.com/mahakaal02/bet/pull/21) | Withdrawal minimum 2,000 coins | Cascaded through Bet form, server validator, Aviator threshold |
| [#22](https://github.com/mahakaal02/bet/pull/22) | India markets + auctions seed lineup | 11 India-specific bet markets, 10-auction seed lineup |
| [#23](https://github.com/mahakaal02/bet/pull/23), [#25](https://github.com/mahakaal02/bet/pull/25) | Login placeholders | Removed seed-credential hints, labels read literal `mobile/email` / `password` |
| [#24](https://github.com/mahakaal02/bet/pull/24) | Prisma seed init container | Helm runs `prisma db seed` on every pod boot |
| [#26](https://github.com/mahakaal02/bet/pull/26), [#27](https://github.com/mahakaal02/bet/pull/27) | Auction seed migration + self-heal | Self-healing init container clears stuck `_prisma_migrations` rows |
| [#28](https://github.com/mahakaal02/bet/pull/28) | Audit-pass fixes | Aviator double-tap + wallet drift, backend login throttle, audit doc |
| [#29](https://github.com/mahakaal02/bet/pull/29) | **Foundation PR** | 28 new tables, 22 enums, 7 skeleton services, `PRODUCTION_ROADMAP.md` |
| [#30](https://github.com/mahakaal02/bet/pull/30) | **PR-NOTIFY-1** | Notification pipeline — `auction_outbid_v1` first event, FCM/email/in-app adapters |
| [#31](https://github.com/mahakaal02/bet/pull/31) | **PR-OUTBOX-1** | Drain loop + dispatcher registry, BidsService migrated to outbox-driven debit |
| [#32](https://github.com/mahakaal02/bet/pull/32) | **PR-AUDIT-1** | Admin audit-log viewer (3 endpoints + SPA page with filter chips + slide-over diff) |
| [#33](https://github.com/mahakaal02/bet/pull/33) | **PR-RBAC-1** | Admin role grants UI (search / detail / grant / revoke) with self-ADMIN-lockout guard |
| [#34](https://github.com/mahakaal02/bet/pull/34) | **PR-SETTINGS-1** | Admin Settings + Feature Flags UI, TTL-cached foundation services |
| [#35](https://github.com/mahakaal02/bet/pull/35) | **PR-MODERATOR-1** | Permission-slug RBAC + first use on audit log (MODERATOR + AUDITOR access) |
| [#36](https://github.com/mahakaal02/bet/pull/36) | **PR-PWRESET-1** | Token-based password reset (30-min single-use, JWT session invalidation) |
| [#37](https://github.com/mahakaal02/bet/pull/37) | **PR-WATCHLIST-1** | Watch/unwatch endpoints + auctions UI (completes outbid pipeline) |
| [#38](https://github.com/mahakaal02/bet/pull/38) | **PR-2FA-1** | TOTP enrollment + login challenge + 10 backup codes, RFC 6238 (no new dep) |
| [#39](https://github.com/mahakaal02/bet/pull/39) | **PR-RG-1** | Responsible-gambling limits + cool-down + self-exclusion, login + bet gates |
| [#40](https://github.com/mahakaal02/bet/pull/40) | **PR-DAILY-1** | Daily login streak rewards (26h grace window, freeze-spend math, 30-day cycle) |
| [#41](https://github.com/mahakaal02/bet/pull/41) | **PR-EMAIL-1** | Email change w/ double-confirm (24h expiry, sha256 token hashes) |
| [#42](https://github.com/mahakaal02/bet/pull/42) | **PR-ADDRESS-1** | Shipping addresses CRUD (default-selection invariants, soft delete) |
| [#43](https://github.com/mahakaal02/bet/pull/43) | **PR-2FA-2** | Trusted-device cookie (sha256-hashed in DB, 90-day expiry, cap=5, cross-revocation on credential changes) |
| [#44](https://github.com/mahakaal02/bet/pull/44) | **PR-PROFILE-1** | Display name + avatar + reserved-name + profanity filter (Devanagari-friendly) |
| [#45](https://github.com/mahakaal02/bet/pull/45) | **PR-DELETION-1** | Account deletion request/cancel/purge + GDPR/DPDP data export bundle |
| [#46](https://github.com/mahakaal02/bet/pull/46) | **PR-IMPERSONATE-1** | Admin impersonation with audit-logged sessions, scoped `purpose:'impersonation'` JWT, admin SPA queue |

### Currently OPEN (review queue)

| PR | Title | Summary |
|---|---|---|
| [#47](https://github.com/mahakaal02/bet/pull/47) | **PR-KYC-1** | Tier ladder (TIER_0 → TIER_3) + encrypted document pipeline (virus-scan → AES-256-GCM → storage) behind interface adapters; S3/ClamAV/KMS are env-var swap-ins (PR-INFRA-* wires the real backends). Withdrawal eligibility endpoint for Bet wallet. 18 unit tests. |
| [#48](https://github.com/mahakaal02/bet/pull/48) | **PR-KYC-2** | Admin review queue (stacked on #47). approve/reject/request-resubmit, decrypted inline preview, every PII view audited. New permission slugs (`kyc.view`, `kyc.review`) on FINANCE + AUDITOR. 5 more tests (23 total in KYC suite). |
| [#49](https://github.com/mahakaal02/bet/pull/49) | **PR-RG-2** | 24h cool-off for limit RAISES (pendingLimits + pendingActivatesAt), session-reminder heartbeat (idle-reset + debounce), aviator pre-bet hook (`assertCanWager`). Lazy scheduler (no cron). 11 new tests (35 total in RG). |
| [#50](https://github.com/mahakaal02/bet/pull/50) | **PR-NOTIFY-2** | SES driver (dependency-free SigV4 + REST), SNS bounce/complaint webhook (auto-confirm subscriptions), new `EmailSuppression` table with case-insensitive PK, 6 new notification templates for the full event family. 9 webhook tests. |
| [#51](https://github.com/mahakaal02/bet/pull/51) | **PR-PROFILE-2** | Admin moderation queue for flagged display names. Borderline patterns (homoglyphs, impersonation prefixes, public-figure fragments) flag-not-block; admin can keep-as-is or force-rename. 8 new tests (27 total in profile). |
| [#52](https://github.com/mahakaal02/bet/pull/52) | **PR-REFERRAL-1** | Per-user 8-char base32 codes (no 0/O/1/I/l). Claim binds referee → referrer one-shot; qualification gate (KYC ≥ TIER_1 + lifetime deposits ≥ min); payout via TWO `BET_WALLET_CREDIT` outbox rows with deterministic idempotency keys. Admin void escape hatch. 18 tests. |
| [#53](https://github.com/mahakaal02/bet/pull/53) | **PR-ORDER-1** | Order lifecycle state machine PENDING_ADDRESS → AWAITING_FULFILLMENT → IN_TRANSIT → DELIVERED with DISPUTED + CANCELLED side paths. Address snapshot decouples ops shipping from later edits / soft-deletes. /me/orders user page + /admin/orders queue. 21 tests. |

All 7 open PRs are **MERGEABLE** at the time of writing (#48 is stacked on #47 — base = `claude/kyc-1`). Cumulative backend test count: **386 passing**.

### Feature flags currently in the DB (all default OFF)

| Flag | Effect when ON |
|---|---|
| `notifications.enabled` | Notification worker drains PENDING rows + dispatches |
| `watchlist.enabled` | Watchlist REST endpoints exposed |
| `watchlist.outbid_notifications` | `OutbidListenerService` fires when bids displace watchers |
| `outbox.enabled` | Outbox worker drains rows |
| `outbox.bid_wallet_debit` | `BidsService.placeBid()` uses outbox path vs legacy sync-HTTP |
| `kyc.enabled` | (after #47 merges) Bet wallet calls `/me/kyc/withdrawal-eligibility` before payouts |

Settings catalog (now ~22 rows after the KYC + referral additions) seeded by the migrations in `backend/prisma/migrations/*_seed/` — admins can tune live via the SETTINGS-1 UI.

---

## Roadmap progress

**At PR-level: 27 / 36 PRs shipped (20 merged + 7 open). 9 PRs remaining.**
**At feature-level: ~23 / 27 features substantially covered.**

| Month | Done | Status |
|---|---|---|
| Month 1 (foundation + auth + roles) | **7 / 7** | ✅ Foundation, NOTIFY-1, OUTBOX-1, AUDIT-1, RBAC-1, MODERATOR-1, SETTINGS-1 |
| Month 2 (compliance + responsible) | **7 / 7** | ✅ PWRESET-1, 2FA-1, 2FA-2, RG-1, RG-2, KYC-1, KYC-2 (RG-2/KYC-* open at #47-#49) |
| Month 3 (engagement) | **9 / 9** | ✅ WATCHLIST-1, DAILY-1, EMAIL-1, ADDRESS-1, PROFILE-1, NOTIFY-2, PROFILE-2, REFERRAL-1, ORDER-1 (#50-#53 open) |
| Month 4 (trust + admin) | **2 / 10** | DELETION-1 + IMPERSONATE-1 done (Day-2 batch); remaining: TICKETS-1, RECON-1, FRAUD-1, CSV-1, CSV-2, SHARE-1, ANALYTICS-1, CAMPAIGN-1 |
| Q2 (hardening) | **0 / 3** | FRAUD-2, BULK-IMG-1, WORKER-EXTRACT (IMPERSONATE-1 already shipped a quarter early) |

Cumulative test count: **386 backend tests passing** (was 222 going into the Day-2 batch, 376 after Day-2 RG-2, 386 after this batch).

---

## What was built

### Phase 1 — Aviator UX (#18–#21, merged)

- Original procedural mascot "Lumen" — canvas paths in `aviator/lib/mascot.ts`.
- Aurora design system — void/midnight palette, 5-tier multiplier ramp.
- Bet panel hardening — synchronous `inFlightRef` double-tap guard, wallet re-fetch on reconnect.

### Phase 2 — Markets + auctions seed (#22, #24, #26, #27, merged)

- 11 India-specific markets, 10-auction seed lineup.
- Self-healing init container that clears stuck `_prisma_migrations` rows.

### Phase 3 — Audit-driven fixes (#28, merged)

- Aviator UX fixes + login throttle + Postgres rotation runbook + `AUDIT_2026-05-20.md`.

### Phase 4 — Production foundation (#29, merged)

`docs/PRODUCTION_ROADMAP.md` (~1900 lines). Schema additions:

- **RBAC**: `Role` enum + `UserRole` grants
- **Audit**: `AdminAuditLog` (append-only)
- **Runtime config**: `FeatureFlag` + `SystemSetting` + `SystemSettingHistory`
- **Outbox**: `Outbox` + kinds
- **Notifications**: `Notification` + `NotificationTemplate` + `NotificationPreference`
- **Engagement**: `Watchlist`, `DailyLogin`, `DailyLoginClaim`, `ReferralClaim`, `UserProfileHistory`
- **Commerce**: `ShippingAddress`, `Order`
- **Compliance**: `KycVerification`, `KycDocument`, `ResponsibleGamblingProfile`, `ResponsibleGamblingEvent`
- **Support**: `SupportTicket`, `SupportMessage`, `SupportAttachment`
- **Auth helpers**: `PasswordReset`, `TwoFactorAuth`, `TrustedDevice`, `EmailChangeRequest`, `AccountDeletion`, `ImpersonationLog`

### Phase 5 — Notification pipeline live (#30, merged)

`auction_outbid_v1` first event. Template renderer + FCM/email/in-app adapters + Postgres polling worker (1.5s SKIP LOCKED) + per-user Socket.IO rooms. 23 unit tests.

### Phase 6 — Outbox + admin tooling (#31, #32, #33, merged)

- **OUTBOX-1**: dispatch loop, BetWallet dispatcher registry, BidsService outbox-mediated debit.
- **AUDIT-1**: admin audit-log viewer with cursor pagination + before/after diff slide-over.
- **RBAC-1**: role grants UI with autocomplete user search, self-ADMIN-lockout guard.

### Phase 7 — Settings + moderator + auth basics (#34–#37, merged)

- **SETTINGS-1**: Admin Settings UI + Feature Flags UI, TTL-cached foundation services (10s flags / 60s settings). Catalog migration (13 rows).
- **MODERATOR-1**: Permission-slug RBAC layer (`@Perm('audit.view')`) + first use on the audit log. MODERATOR + AUDITOR now read the log without ADMIN escalation. 22 new tests.
- **PWRESET-1**: 30-min single-use token reset. `User.passwordChangedAt` ↔ JWT `iat` for cross-device session invalidation. 13 new tests.
- **WATCHLIST-1**: Watch/unwatch CRUD + auctions UI + /me/watchlist page. Completes the outbid notification pipeline. 11 new tests.

### Phase 8 — Security + responsible play (#38, #39, merged)

- **2FA-1**: TOTP (RFC 6238, no new dep), AES-256-GCM secret cipher, 10 backup codes, 5-attempt lockout, two-step login flow with `purpose: '2fa_challenge'` JWT. 45 new tests.
- **RG-1**: Responsible-gambling limits + cool-down + self-exclusion. Lower-instant / raise-refused (raise-cool-off in PR-RG-2). Login + bid gates. `rg_*` notification templates bypass marketing opt-outs (regulatory carve-out). 24 new tests.

### Phase 9 — Engagement + lifecycle (#40–#42, merged)

- **DAILY-1**: streak math (26h grace, freeze-spend at streak ≥ 7), wallet credit outside Prisma tx (retry-idempotent under `daily_login:<claim.id>`). 22 new tests.
- **EMAIL-1**: double-confirm email change with two sha256 tokens (one each side), 24h expiry, `User.email` updated atomically with `appliedAt`. New `EmailAdapter.sendDirect()` for addresses not on the user row. 15 new tests.
- **ADDRESS-1**: CRUD with default-selection invariants (first-auto, single tx demote-then-promote, refuse-unflag-only-default, soft-delete auto-promote). PII-at-rest hook in place as passthrough stubs. 21 new tests.

### Phase 10 — Day-2 program (#43–#46, merged)

- **2FA-2**: Trusted-device cookie. sha256(cookie) → `deviceHash` (DB never sees plaintext). 90-day TTL, cap 5 devices/user (oldest-by-lastSeenAt evicted). Cross-revoke wired to PasswordResetService + TwoFactorService disable paths. 21 new tests.
- **PROFILE-1**: Display name (`\p{L}\p{M}\p{N}` regex — Devanagari-friendly) + avatar upload (per-user dir, lazy mkdir), 30-day rename cooldown, RESERVED + PROFANITY hard-block lists (English + Hindi script + Romanised). 35 new tests across two specs.
- **DELETION-1**: Two-step deletion request (type username to arm), 30-day cool-off, purge anonymises (email=null, username=deleted-<short>, passwordHash='<purged>') while keeping forensic+regulatory rows intact. GDPR/DPDP data-export as synchronous Promise.all bundle. 17 new tests.
- **IMPERSONATE-1**: Admin "act as" with reason gate (≥10 chars), self/admin-on-admin refusal, scoped `purpose: 'impersonation'` JWT carrying `actorId` + `impersonationId`. Admin SPA queue. 12 new tests.

### Phase 11 — Day-3 program (#47–#53, OPEN review queue)

- **KYC-1**: User-facing KYC. Tier ladder + encrypted document pipeline behind storage / scanner / cipher interfaces. EICAR test proves infected bytes never persist. `withdrawalEligibility()` for Bet wallet. 18 tests.
- **KYC-2**: Admin half (stacked on KYC-1). approve/reject/resubmit with decrypted inline preview; every PII read audited. New `kyc.view` + `kyc.review` permission slugs. 5 more tests.
- **RG-2**: 24h cool-off for limit raises (stages in `pendingLimits` JSON + activates at `pendingActivatesAt`); lazy scheduler promotes during `getProfile` / `recordSessionPing`. Session-reminder heartbeat (30-min idle reset, fired-once debounce). `assertCanWager` aviator pre-bet hook. 11 new tests.
- **NOTIFY-2**: Real SES driver — REST + inline SigV4, zero new npm deps. SNS bounce/complaint webhook auto-confirms subscriptions + writes the new `EmailSuppression` table. Six new templates for auction_won / withdrawal_approved / withdrawal_rejected / topup_succeeded / kyc_state_changed / referral_qualified. 9 webhook tests.
- **PROFILE-2**: Borderline-suspicious display names (homoglyphs, impersonation prefixes, public-figure fragments) flag-not-block into a moderation queue. Admin keep-as-is or force-rename. 8 new tests.
- **REFERRAL-1**: Per-user 8-char base32 referral codes (no 0/O/1/I/l), one-shot claim, KYC + first-deposit qualification gate, payouts via two outbox `BET_WALLET_CREDIT` rows with deterministic idempotency keys (no double-credit on retry). Admin void tool. 18 tests.
- **ORDER-1**: Order lifecycle state machine. Address snapshot decouples shipping from later edits / soft-deletes. /me/orders user page + /admin/orders queue. 21 tests.

---

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| **Push provider** | FCM directly | Reuses existing driver, lower lock-in than OneSignal. |
| **Email provider** | SES via dependency-free SigV4 (PR-NOTIFY-2) | Avoid pulling `@aws-sdk/client-ses` into the bundle for a single API call. SendGrid + Postmark plug-in points kept. |
| **SNS webhook validation** | Topic-ARN gate now, full SigV4 verification deferred (PR-NOTIFY-3) | Stops the cheap spoofs; full crypto verification of every webhook is heavy and lands when SES domain verification ships. |
| **Email suppression** | Postgres table (`EmailSuppression`) read on every send | Read-mostly, write-rare — DB row cache handles this without a TtlCache layer. |
| **Background worker** | In-process Postgres polling (1.5s SKIP LOCKED) | No new infra. BullMQ swap-in is a 1-PR follow-up. |
| **Foundation cache** | In-memory TTL Map (10s flags, 60s settings) | Matches Redis-without-PUBSUB SLA; Redis swap is pure infra. |
| **Foundation services DI** | `PrismaService` (singleton from PrismaModule) | Matches the rest of the backend. |
| **Outbox `MAX_ATTEMPTS`** | 7 (six retries before DEAD) | Last backoff slot (12h) is reachable per docs. |
| **`AdminAuditLog` retention** | 7 years, archive to Glacier after 2y | Financial compliance (separate background job PR). |
| **Self-ADMIN-revoke** | Server-side block | Prevents self-lockout footgun. |
| **CSRF / admin SPA tokens** | localStorage today, plan for httpOnly cookies | Deferred to PR-ADMIN-COOKIE-AUTH (Q2). |
| **TOTP library** | None — direct RFC 6238 impl in `auth/totp.ts` | 30 lines of well-specified math; supply-chain hygiene. 5 RFC vectors pinned in tests. |
| **KYC storage / scanner / cipher** | Interface adapters (disk + stub scanner + local key in dev) | Env-var swap-ins (`KYC_STORAGE_DRIVER=s3`, `KYC_VIRUS_SCANNER=clamav`, `KYC_CIPHER_DRIVER=kms`) — infra PRs (PR-INFRA-S3-1 / -CLAMAV-1 / -KMS-1) flip them. |
| **EICAR scanner test** | Stub scanner trips on the canonical EICAR string | Lets the integration test prove "infected → no persistence" without dragging in real ClamAV. |
| **RG raise-limit cool-off** | 24h staging via `pendingLimits` JSON + `pendingActivatesAt` | Lower instant, raise deferred. Lazy scheduler avoids a cron — promotes on next `getProfile` / heartbeat. |
| **RG check on every JWT validation** | Yes | Self-exclusion wouldn't be effective if a stale JWT could still bid. |
| **Session-reminder cadence** | 60s heartbeat from the client, 30-min idle-reset, debounced via `lastReminderAt` | No always-on WebSocket needed; reminder fires once per session, INAPP delivery via existing pipeline. |
| **Daily-login wallet credit** | Outside the Prisma `$transaction` | Avoids rolling back the claim if the wallet host is briefly down. `daily_login:<claim.id>` keeps retries idempotent. |
| **Email-change tokens** | Two distinct tokens, sha256 hash only on DB | Possession-of-both-mailboxes is the real defence; storing only hashes survives DB leak. |
| **Address PII at rest** | Passthrough stub today | `SecretCipher` (PR-2FA-1) is the swap target; isolated to two helpers (`encryptRow`/`decryptRow`) so PR-ADDRESS-PII is a 30-line change. |
| **Profile moderation** | Hard-block + flag-and-queue split | Profanity stays hard-blocked (PR-PROFILE-1). Borderline patterns (homoglyphs, impersonation prefixes) accept-then-queue for admin eyes (PR-PROFILE-2). |
| **Trusted-device cookie** | sha256 hashed in DB, plaintext delivered once | Same pattern as the password-reset token. DB leak ≠ session takeover. |
| **Impersonation JWT** | Same shape as a normal session, with `purpose: 'impersonation'` + `actorId` | Downstream code Just Works; audit writers inspect `actorId` to record "who's really behind the wheel". |
| **Referral payout** | Two `BET_WALLET_CREDIT` outbox rows with `referral:<claimId>:{referrer,referee}` keys | Atomic with the QUALIFIED transition; idempotent on retry; Bet wallet dispatcher consumes them. |
| **Order address snapshot** | Full JSON copy at `setShippingAddress` time | Decouples shipping from later edits / soft-deletes of the source row — ops always ships to the captured destination. |

---

## File structure

```
docs/
├── AUDIT_2026-05-20.md
├── PRODUCTION_ROADMAP.md          ← 27-feature program design
├── CONTEXT.md                      ← this file
└── superpowers/                    ← (pre-existing)

backend/
├── prisma/
│   ├── schema.prisma               ← 46+ tables, 24+ enums
│   └── migrations/
│       ├── … (foundation, notify_seed, outbox_seed, settings_catalog)
│       ├── 20260521000000_2fa_seed                ← 2FA-1
│       ├── 20260521010000_rg_seed                 ← RG-1
│       ├── 20260521020000_daily_login_seed        ← DAILY-1
│       ├── 20260521030000_email_change_seed       ← EMAIL-1
│       ├── 20260521040000_acct_deletion_seed      ← DELETION-1
│       ├── 20260522000000_kyc_seed                ← KYC-1 (open)
│       ├── 20260522010000_rg2_cooloff_session     ← RG-2 (open)
│       ├── 20260522020000_notify2_seed            ← NOTIFY-2 (open)
│       ├── 20260522030000_profile2_moderation     ← PROFILE-2 (open)
│       ├── 20260522040000_referral_settings_seed  ← REFERRAL-1 (open)
│       └── 20260522050000_order_relations         ← ORDER-1 (open)
│
├── src/
│   ├── foundation/
│   │   ├── feature-flags.service.ts                ← cached
│   │   ├── settings.service.ts                     ← cached
│   │   ├── audit-log.service.ts
│   │   ├── notification.service.ts
│   │   ├── outbox.service.ts + outbox.worker.ts
│   │   ├── ttl-cache.ts                            ← shared cache helper
│   │   ├── rbac.decorator.ts + roles.guard.ts
│   │   └── foundation.module.ts (@Global)
│   │
│   ├── auth/
│   │   ├── auth.service.ts                         ← RG gate + 2FA challenge composition + impersonation JWT payload
│   │   ├── password-reset.service.ts               ← PWRESET-1
│   │   ├── totp.ts + secret-cipher.ts              ← 2FA-1
│   │   ├── two-factor.service.ts                   ← 2FA-1
│   │   ├── trusted-device.service.ts               ← 2FA-2
│   │   ├── email-change.service.ts                 ← EMAIL-1
│   │   └── (controllers + specs)
│   │
│   ├── admin/
│   │   ├── audit.controller.ts                     ← Perm('audit.view')
│   │   ├── roles.controller.ts                     ← RBAC-1
│   │   ├── settings.controller.ts                  ← SETTINGS-1
│   │   ├── feature-flags.controller.ts             ← SETTINGS-1
│   │   ├── permissions.ts + perms.guard.ts         ← MODERATOR-1 + kyc.view/review (KYC-2)
│   │   └── admin.module.ts
│   │
│   ├── notifications/                              ← NOTIFY-1, NOTIFY-2
│   │   ├── notification-worker.ts
│   │   ├── notification-broadcast.gateway.ts
│   │   ├── template-renderer.ts
│   │   ├── outbid-listener.service.ts
│   │   ├── email-webhook.service.ts                ← NOTIFY-2 (open)
│   │   ├── email-webhook.controller.ts             ← NOTIFY-2 (open)
│   │   └── adapters/ (inapp, push, email, ses-sender)
│   │
│   ├── watchlist/                                  ← WATCHLIST-1
│   ├── responsible-gambling/                       ← RG-1, RG-2 (open)
│   ├── daily-login/                                ← DAILY-1
│   ├── addresses/                                  ← ADDRESS-1
│   ├── profile/                                    ← PROFILE-1, PROFILE-2 (open)
│   │   └── profile-admin.controller.ts             ← PROFILE-2 (open)
│   ├── account-deletion/                           ← DELETION-1
│   ├── impersonation/                              ← IMPERSONATE-1
│   ├── kyc/                                        ← KYC-1, KYC-2 (open, stacked)
│   │   ├── kyc.service.ts
│   │   ├── kyc.controller.ts
│   │   ├── kyc-admin.controller.ts
│   │   ├── kyc-storage.ts (disk + S3 stub)
│   │   ├── virus-scanner.ts (stub + ClamAV stub)
│   │   └── document-cipher.ts (local-key + KMS stub)
│   ├── referrals/                                  ← REFERRAL-1 (open)
│   └── orders/                                     ← ORDER-1 (open)
│
auctions/                                            ← Next.js public surface
└── app/
    ├── login/LoginForm.tsx                         ← 2FA two-step + Forgot link
    ├── auth/
    │   ├── forgot/                                 ← PWRESET-1
    │   ├── reset/                                  ← PWRESET-1
    │   └── email-change/confirm/                   ← EMAIL-1
    ├── me/
    │   ├── 2fa/                                    ← 2FA-1 + 2FA-2 trusted-device panel
    │   ├── rg/                                     ← RG-1
    │   ├── daily/                                  ← DAILY-1
    │   ├── email/                                  ← EMAIL-1
    │   ├── addresses/                              ← ADDRESS-1
    │   ├── watchlist/                              ← WATCHLIST-1
    │   ├── profile/                                ← PROFILE-1
    │   ├── delete/                                 ← DELETION-1
    │   ├── kyc/                                    ← KYC-1 (open)
    │   ├── referrals/                              ← REFERRAL-1 (open)
    │   └── orders/                                 ← ORDER-1 (open)
    ├── notifications/                              ← NOTIFY-1
    ├── profile/page.tsx                            ← cards added per PR (now: Profile / Security / RG / Daily / Account/email / Shipping / Referrals / Orders / Identity / Danger zone)
    └── api/                                        ← thin proxies for each /me/* endpoint

auctions/components/
└── SessionHeartbeat.tsx                            ← RG-2 (open) — 60s ping, debounced toast

admin/                                               ← Vite SPA
└── src/pages/
    ├── AuditLog.tsx                                ← AUDIT-1
    ├── Roles.tsx                                   ← RBAC-1
    ├── Settings.tsx                                ← SETTINGS-1
    ├── FeatureFlags.tsx                            ← SETTINGS-1
    ├── Impersonate.tsx                             ← IMPERSONATE-1
    ├── KycReview.tsx                               ← KYC-2 (open)
    └── ProfileModeration.tsx                       ← PROFILE-2 (open)
```

---

## What's left to do

Per [`PRODUCTION_ROADMAP.md`](PRODUCTION_ROADMAP.md). **8 PRs remaining** (plus the infra triplet for KYC storage/scan/cipher swap-ins).

### Month 4 remainder

- [ ] **PR-TICKETS-1** — Support ticket inbox (`SupportTicket` already in schema). User submit + admin reply.
- [ ] **PR-RECON-1** — Daily reconciliation of CoinTransaction vs. Bet's wallet ledger.
- [ ] **PR-FRAUD-1** — Velocity + cluster heuristics. Consumes the referral fingerprint columns.
- [ ] **PR-CSV-1** — Admin CSV export of withdrawals + reconciliation.
- [ ] **PR-CSV-2** — Bulk admin imports (auction lineup, coin packs).
- [ ] **PR-SHARE-1** — Public auction share page (no auth) for social.
- [ ] **PR-ANALYTICS-1** — Per-user funnel + cohort dashboard (admin).
- [ ] **PR-CAMPAIGN-1** — Coin-pack promo / discount codes.

### Quarter 2 (infra + late audit)

- [ ] **PR-FRAUD-2** — Manual review queue + admin block actions on top of FRAUD-1.
- [ ] **PR-BULK-IMG-1** — Storage abstraction (S3 + EXIF strip + resize) shared between avatars + KYC + auction images.
- [ ] **PR-WORKER-EXTRACT** — Lift the notification + outbox workers into a dedicated pod.
- [ ] **PR-INFRA-S3-1 / PR-INFRA-CLAMAV-1 / PR-INFRA-KMS-1** — Wire the real backends that KYC-1's adapters point at.
- [ ] **PR-NOTIFY-3** — Full SNS SigV4 signature verification on the webhook.
- [ ] **PR-ADMIN-COOKIE-AUTH** — httpOnly cookie auth on the admin SPA (replaces localStorage JWT).
- [ ] **PR-ANDROID-SECURITY** — Cleartext HTTP block + EncryptedSharedPreferences token storage.

---

## How to pick this up

```bash
git fetch origin
git checkout main
git pull
```

### Current review queue

The 7 open PRs (#47–#53) are all CLEAN/MERGEABLE. **#48 (KYC-2) is stacked on #47 (KYC-1)** — base is `claude/kyc-1`, so merge #47 first, GitHub will auto-rebase #48 onto `main`.

Suggested merge order — minimises cascade conflicts:

1. **#47 KYC-1** — no shared anchor points with the others.
2. **#48 KYC-2** — auto-rebases after #47.
3. **#49 RG-2** — only touches `responsible-gambling/*` + a layout root.
4. **#50 NOTIFY-2** — only touches `notifications/*`.
5. **#51 PROFILE-2** — touches `profile/*` + `admin/src/App.tsx` (potential cascade).
6. **#52 REFERRAL-1** — touches `app.module.ts` + `auctions/app/profile/page.tsx`.
7. **#53 ORDER-1** — touches `app.module.ts` + `auctions/app/profile/page.tsx` + `prisma/schema.prisma`.

Each touches `auctions/app/profile/page.tsx` to drop in its card link → minor "take both" merges expected on the last 2-3 PRs.

### Run the stack locally

```bash
cd backend && npm install && npx prisma generate && npx prisma migrate deploy && npm run start:dev
cd ../auctions && npm install && npm run dev   # :3200
cd ../admin && npm install && npm run dev      # :5173
```

### Flip a feature flag

After merging the open PRs:

```bash
# In the admin SPA: /feature-flags → toggle
# Or via SQL on the backend pod:
kubectl exec -n kalki <backend-pod> -- \
  npx prisma db execute --stdin --schema=prisma/schema.prisma <<< \
  "UPDATE \"FeatureFlag\" SET enabled = true WHERE id = 'kyc.enabled';"
```

### Tests + typechecks

```bash
cd backend && npx tsc --noEmit && npx jest        # 386/386 passing on this batch
cd auctions && npx tsc --noEmit
cd admin && npx tsc --noEmit
```

---

## Open architecture questions

From [`PRODUCTION_ROADMAP.md`](PRODUCTION_ROADMAP.md):

1. **FCM vs OneSignal vs custom** for push at scale. Currently FCM; revisit at 100k DAU.
2. **Self-hosted ClamAV vs AWS Macie/GuardDuty** for KYC virus scanning. Currently planned self-hosted (PR-INFRA-CLAMAV-1).
3. **MeiliSearch for user search** at > 1M users. Currently Postgres ILIKE.
4. **Hot vs cold KYC document storage**. Currently planned hot for first year.
5. **Aadhaar last-4 only vs full**. Currently last-4 (`AADHAAR_LAST4` enum).
6. **In-app notification retention**. Currently 90 days planned.
7. **`db push --accept-data-loss` removal**. Currently kept with self-healing cleanup.
8. **Worker scale-out trigger**. In backend pod until queue depth > 10k or worker CPU > 60%.
9. **Redis cache layer**. Currently in-memory `TtlCache`; same SLA as Redis-without-PUBSUB. Promote when multi-pod cache invalidation matters.
10. **SNS webhook signature verification**. Deferred to PR-NOTIFY-3 (topic-ARN gate active now).
11. **Dedicated `COMPLIANCE` role**. KYC review permissions currently squat on `FINANCE` (with the role-mapping comment). Splits when the next RBAC refactor adds the enum value.
12. **`order.*` permission slug family**. Order ops currently re-use `withdrawal.*` slugs (FINANCE). Dedicated slugs land when ops staffing gets a separate role.

---

## Where the audit findings stand

| Finding | Status |
|---|---|
| #1 Schema drift on `Auction.startsAt` | ✅ Fixed in #27 |
| #2 Stuck `_prisma_migrations` row | ✅ Self-healing init container in #27 |
| #3 Postgres password in git | 📝 Documented runbook; rotation pending |
| #4 Admin SPA localStorage JWT | ⏳ PR-ADMIN-COOKIE-AUTH (Q2) |
| #5 Android cleartext HTTP | ⏳ PR-ANDROID-SECURITY (Q2) |
| #6 Android plaintext token storage | ⏳ PR-ANDROID-SECURITY (Q2) |
| #7 Razorpay webhook missing | ⏳ TBD — needs SES domain verification first (now within reach after PR-NOTIFY-2) |
| #8 Bid placement cross-service consistency | ✅ Fixed in PR-OUTBOX-1 (#31) |
| #9 Aviator double-tap | ✅ Fixed in #28 |
| #10 Aviator wallet drift | ✅ Fixed in #28 |
| #11 Login throttle | ✅ Fixed in #28 |
| #12 NO_WINNER ringmaster cascade | ⏳ Backlog, low priority |
| #13 `db push --accept-data-loss` fallback | 📝 Documented; deferred |

---

*End of context. Refresh this file after each batch of PRs lands so the next session can pick up cold.*
