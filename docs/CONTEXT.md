# Project Context — engineering handoff

**As of 2026-05-20** (Q2 hardening batch landed)

Snapshot of where the Kalki Bet monorepo stands after the multi-PR production-readiness program. Pick this up cold; everything you need to continue is referenced inline.

**TL;DR for someone walking in cold:** 36/36 PR-classes shipped (31 merged, 5 in review). All 27 product features built. All Q2 hardening (workers, infra, security) shipped. Backend test count: **640 passing**.

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
| [#43](https://github.com/mahakaal02/bet/pull/43) | **PR-2FA-2** | Trusted-device cookie (sha256-hashed, 90-day expiry, cap=5, cross-revocation) |
| [#44](https://github.com/mahakaal02/bet/pull/44) | **PR-PROFILE-1** | Display name + avatar + reserved-name + profanity filter (Devanagari-friendly) |
| [#45](https://github.com/mahakaal02/bet/pull/45) | **PR-DELETION-1** | Account deletion request/cancel/purge + GDPR/DPDP data export bundle |
| [#46](https://github.com/mahakaal02/bet/pull/46) | **PR-IMPERSONATE-1** | Admin impersonation with audit-logged sessions, scoped `purpose:'impersonation'` JWT |
| [#47](https://github.com/mahakaal02/bet/pull/47) | **PR-KYC-1** | Tier ladder + encrypted document pipeline behind storage/scanner/cipher adapters |
| [#48](https://github.com/mahakaal02/bet/pull/48) | **PR-KYC-2** | Admin review queue + decrypted inline preview, every PII view audited |
| [#49](https://github.com/mahakaal02/bet/pull/49) | **PR-RG-2** | 24h limit-raise cool-off + session reminder heartbeat + aviator pre-bet hook |
| [#50](https://github.com/mahakaal02/bet/pull/50) | **PR-NOTIFY-2** | Dependency-free SES driver + SNS bounce/complaint webhook + EmailSuppression table |
| [#51](https://github.com/mahakaal02/bet/pull/51) | **PR-PROFILE-2** | Admin moderation queue for borderline display names (homoglyph / impersonation detection) |
| [#52](https://github.com/mahakaal02/bet/pull/52) | **PR-REFERRAL-1** | Per-user codes + claim + KYC+deposit qualification + dual-outbox payout |
| [#53](https://github.com/mahakaal02/bet/pull/53) | **PR-ORDER-1** | Order lifecycle state machine + address snapshot + admin queue |
| [#55](https://github.com/mahakaal02/bet/pull/55) | **PR-TICKETS-1** | Support ticket inbox + admin queue + SLA timer + internal notes |
| [#56](https://github.com/mahakaal02/bet/pull/56) | **PR-RECON-1** | Nightly local-vs-Bet wallet reconciliation + admin ack workflow |
| [#57](https://github.com/mahakaal02/bet/pull/57) | **PR-FRAUD-1** | Velocity + cluster heuristics → FraudSignal queue |
| [#58](https://github.com/mahakaal02/bet/pull/58) | **PR-CSV-1** | Admin CSV exports — streaming async-iterator + 1M-row cap + UTF-8 BOM |
| [#59](https://github.com/mahakaal02/bet/pull/59) | **PR-CSV-2** | Bulk admin imports — zero-dep RFC 4180 parser, dry-run by default |
| [#60](https://github.com/mahakaal02/bet/pull/60) | **PR-SHARE-1** | Public no-auth /share/[id] page with OG + Twitter Card meta |
| [#61](https://github.com/mahakaal02/bet/pull/61) | **PR-ANALYTICS-1** | Admin funnel + weekly cohort retention dashboard |
| [#62](https://github.com/mahakaal02/bet/pull/62) | **PR-CAMPAIGN-1** | Coin-pack promo codes with lifetime + per-user caps |
| [#64](https://github.com/mahakaal02/bet/pull/64) | **PR-FRAUD-2** | Bulk-ack + cluster-ban + unban admin actions on top of FRAUD-1 |
| [#65](https://github.com/mahakaal02/bet/pull/65) | **PR-BULK-IMG-1** | Unified storage abstraction + EXIF-strip image processor (shared across avatars / KYC / auctions) |
| [#66](https://github.com/mahakaal02/bet/pull/66) | **PR-WORKER-EXTRACT** | Dedicated worker pod via `KALKI_ROLE=worker` env switch; api-mode unchanged for backwards compat |
| [#67](https://github.com/mahakaal02/bet/pull/67) | **PR-INFRA-S3-1** | Real `S3KycStorage` via inline SigV4 REST (no `@aws-sdk/*` dep) |

### Currently OPEN (review queue — Q2 hardening triplet + late audit follow-ups)

| PR | Title | Summary |
|---|---|---|
| [#68](https://github.com/mahakaal02/bet/pull/68) | **PR-INFRA-CLAMAV-1** | Real `ClamAvVirusScanner` over the native INSTREAM TCP protocol — zero new deps. Helm `clamav.yaml` deploys clamav/clamav:1.3 with freshclam + a 2 GiB PVC for the signature DB. Wired conditionally on `clamav.enabled`. 12 unit tests via EventEmitter-backed fake socket. |
| [#69](https://github.com/mahakaal02/bet/pull/69) | **PR-INFRA-KMS-1** | Real `KmsDocumentCipher` — envelope encryption (KMS `GenerateDataKey` for the DEK, AES-256-GCM for the payload). KMS-wrapped DEK in the envelope; version byte 100. Inline SigV4 against KMS JSON-1.1 protocol. 13 unit tests with an in-memory fake KMS. |
| [#70](https://github.com/mahakaal02/bet/pull/70) | **PR-NOTIFY-3** | SNS RSA signature verification on the SES webhook. Validates `SigningCertURL` is on `*.amazonaws.com` + `.pem`, fetches + caches cert, builds canonical string-to-sign per envelope type, verifies SignatureVersion 1 (SHA1) and 2 (SHA256). Activated by `NOTIFY_SNS_VERIFY=true`. 28 unit tests using a real in-process RSA keypair. |
| [#71](https://github.com/mahakaal02/bet/pull/71) | **PR-ADMIN-COOKIE-AUTH** | Admin SPA migrated from localStorage JWT to HttpOnly + SameSite=Lax cookie. JwtStrategy extracts from either Bearer or cookie (mobile unchanged). New `/auth/admin/login`, `/auth/admin/login/2fa`, `/auth/admin/logout`, `/auth/admin/sso-token`, `/auth/admin/sso-accept`. 26 unit tests (cookie helpers + controller). |
| [#72](https://github.com/mahakaal02/bet/pull/72) | **PR-ANDROID-SECURITY** | Android: cleartext blocked at the network-security-config level (debug-only carve-out for 10.0.2.2); bearer JWT now lives in EncryptedSharedPreferences with the Android Keystore as the root-of-trust. One-shot migration from the legacy plaintext file + Keystore-failure fallback. |

All 5 open PRs are CLEAN/MERGEABLE. They're orthogonal — merge in any order. Cumulative backend test count: **640 passing** (Q2 added +122 over the 518 from the Month-4 batch).

### Feature flags currently in the DB (all default OFF)

| Flag | Effect when ON |
|---|---|
| `notifications.enabled` | Notification worker drains PENDING rows + dispatches |
| `watchlist.enabled` | Watchlist REST endpoints exposed |
| `watchlist.outbid_notifications` | `OutbidListenerService` fires when bids displace watchers |
| `outbox.enabled` | Outbox worker drains rows |
| `outbox.bid_wallet_debit` | `BidsService.placeBid()` uses outbox path vs legacy sync-HTTP |
| `kyc.enabled` | Bet wallet calls `/me/kyc/withdrawal-eligibility` before payouts |
| `reconciliation.enabled` | (after #56 merges) Nightly recon cron runs at 02:00 UTC |
| `fraud.evaluator_enabled` | (after #57 merges) Nightly cluster sweep at 03:00 UTC |

Settings catalog (now ~30 rows after KYC + referral + fraud + tickets additions) seeded by the migrations in `backend/prisma/migrations/*_seed/`.

---

## Roadmap progress

**At PR-level: 36 / 36 PR-classes shipped (31 merged + 5 open).** All 27 product features built; all Q2 hardening (workers + infra + cross-surface security) shipped.

| Month | Done | Status |
|---|---|---|
| Month 1 (foundation + auth + roles) | **7 / 7** | ✅ Foundation, NOTIFY-1, OUTBOX-1, AUDIT-1, RBAC-1, MODERATOR-1, SETTINGS-1 |
| Month 2 (compliance + responsible) | **7 / 7** | ✅ PWRESET-1, 2FA-1, 2FA-2, RG-1, RG-2, KYC-1, KYC-2 |
| Month 3 (engagement) | **9 / 9** | ✅ WATCHLIST-1, DAILY-1, EMAIL-1, ADDRESS-1, PROFILE-1, NOTIFY-2, PROFILE-2, REFERRAL-1, ORDER-1 |
| Month 4 (trust + admin) | **10 / 10** | ✅ DELETION-1 + IMPERSONATE-1 + TICKETS-1, RECON-1, FRAUD-1, CSV-1, CSV-2, SHARE-1, ANALYTICS-1, CAMPAIGN-1 |
| Q2 (hardening — merged) | **4 / 4** | ✅ FRAUD-2, BULK-IMG-1, WORKER-EXTRACT, INFRA-S3-1 |
| Q2 (hardening — review queue) | **5 / 5** | 🟡 INFRA-CLAMAV-1, INFRA-KMS-1, NOTIFY-3, ADMIN-COOKIE-AUTH, ANDROID-SECURITY |

Cumulative backend test count: **640 passing** (Day 1: 222 → Day 2: 376 → Day 3: 386 → Day 4: 518 → Q2: **640**). Q2 added +122 across 5 PRs.

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

`docs/PRODUCTION_ROADMAP.md` (~1900 lines). 28 new tables, 22 enums, 7 skeleton services. See prior CONTEXT.md revisions for the full table breakdown.

### Phase 5–10 — Day-1, Day-2, Day-3 user/admin programs (#30–#53, merged)

Notifications, outbox, audit log, RBAC, settings, moderator perms, password reset, watchlist, 2FA-1, RG-1, daily-login, email-change, addresses, trusted devices, profile, account deletion, impersonation, KYC tier system, RG cool-off, SES driver, profile moderation, referrals, orders. Each ships its own service + spec + admin SPA where applicable. See prior CONTEXT.md revisions for per-PR detail.

### Phase 11 — Month-4 trust + admin batch (#55–#62, merged)

- **TICKETS-1** — Support ticket inbox. User /me/support with anti-duplicate-per-category; admin queue with SLA-warmest-first sort + internal notes hidden from user. First admin public reply stamps `firstResponseAt` for SLA hit-rate analytics. 17 tests.
- **RECON-1** — Nightly local-vs-Bet wallet reconciliation. Per-user `localSum` (CoinTransaction sum) vs `remoteSum` (Bet balance) → `ReconciliationDiscrepancy` rows for non-zero drift. `BalanceFetcher` interface keeps the service unit-testable + lets us swap in a batch endpoint later. Idempotent on `forDate`. Admin ack workflow. 12 tests.
- **FRAUD-1** — Velocity (bid-burst per user per window) + cluster (shared IP / device / referrer) heuristics → `FraudSignal` rows. Severity scales (1×=LOW, 2×=MEDIUM, 5×=HIGH). Cron sweep at 03:00 UTC. Admin review queue. 16 tests.
- **CSV-1** — Streaming admin exports (audit log, coin transactions, orders) with cursor pagination + 1M-row safety cap. UTF-8 BOM prefix for Excel compatibility. `csvEscape` / `csvRow` RFC 4180 helpers reused by CSV-2. 15 tests.
- **CSV-2** — Bulk admin imports for coin packs + auctions. Zero-dep RFC 4180 parser. Dry-run-by-default (`?dryRun=false` required to write); one Prisma transaction per commit; refuses to write if ANY row fails validation. 21 tests.
- **SHARE-1** — Public no-auth `/share/[id]` route with OpenGraph + Twitter Card meta tags. Re-uses the already-public `GET /auctions/:id` endpoint — zero backend changes.
- **ANALYTICS-1** — Funnel (signup → email → phone → KYC ≥ TIER_1 → first deposit → first bid) + weekly cohort retention. UTC-Monday-anchored buckets. Plain divs + tables — no charting lib pulled in. 9 tests.
- **CAMPAIGN-1** — Coin-pack promo codes. PERCENT (1-100) or FLAT (paise). Lifetime + per-user caps. Optional CoinPack allowlist. Pure `validate()` / `redeem()` split keeps brute-force probes from affecting the per-user cap. 21 tests.

### Phase 12 — Q2 hardening, merged (#64–#67)

- **FRAUD-2** — Manual review queue + admin block actions on top of FRAUD-1. Bulk-ack via signal-id list, cluster-ban with snapshot-before-update aliasing fix (same pattern as PR-ORDER-1), unban with audit trail.
- **BULK-IMG-1** — Generic `Storage` interface (`put` / `get` / `delete` / `urlFor`) backed by disk in dev, S3 in prod. `SharpImageProcessor` resizes + EXIF-strips uploads; `sharp` is lazy-loaded via `Function('return import(...)')` so dev/CI builds without the native dep still boot. `assertSafeKey` blocks path traversal + absolute paths.
- **WORKER-EXTRACT** — Two-mode bootstrap (`KALKI_ROLE=api` / `worker`). Worker mode creates the application context without an HTTP listener; @Cron jobs still fire, SIGTERM drains cleanly. Helm `backend-worker.yaml` deploys a single-replica pod (leader election → PR-LEADER-ELECT). API-mode default = backwards-compat with the legacy single-pod topology.
- **INFRA-S3-1** — Real `S3KycStorage` using a zero-dep SigV4 signer in `backend/src/aws/sigv4.ts`. PUT / GET / DELETE against path-style URLs. Two layers of encryption: app-level (KMS envelope, PR-INFRA-KMS-1) + S3 SSE-KMS (this PR). `assertCreds` loud-fails when AWS creds missing — better than silent unsigned requests.

### Phase 13 — Q2 hardening, in review (#68–#72)

- **INFRA-CLAMAV-1** — Real `ClamAvVirusScanner` speaks the ClamAV INSTREAM TCP protocol natively (~80 lines vs the 400-line `aws-sns-validator`-style wrappers). EventEmitter-backed fake socket pattern in the spec — no real clamd needed in CI. Helm `clamav.yaml` deploys the daemon with freshclam + a 2 GiB signature-DB PVC; wired conditionally on `clamav.enabled`. 12 tests.
- **INFRA-KMS-1** — Real `KmsDocumentCipher` uses **envelope encryption**: KMS `GenerateDataKey` returns a per-doc AES-256 DEK + a wrapped form; local AES-256-GCM encrypts the payload with the DEK; wrapped DEK travels in the envelope. Version byte 100 leaves 1–99 for `LocalKeyDocumentCipher` rotations. DEK zeroed in a `finally` block (best-effort). 13 tests with an in-memory fake KMS.
- **NOTIFY-3** — Full SNS RSA signature verification on the webhook. `SigningCertURL` validated to `https://*.amazonaws.com/*.pem`, cert fetched + cached, canonical string-to-sign built per envelope type (Notification vs SubscriptionConfirmation), RSA-SHA1 / RSA-SHA256 per `SignatureVersion`. Activated by `NOTIFY_SNS_VERIFY=true`. 28 tests using a real in-process RSA keypair.
- **ADMIN-COOKIE-AUTH** — Admin SPA migrated off localStorage. New `/auth/admin/*` endpoint family sets a `kalki_admin_session` HttpOnly + SameSite=Lax cookie. `JwtStrategy` extracts from either Bearer (mobile + API) or cookie (admin) — explicit Bearer beats ambient cookie. Two SSO helpers (`sso-token` / `sso-accept`) keep cross-app handoff working without exposing the JWT to JS. 26 tests (cookie helpers + admin controller).
- **ANDROID-SECURITY** — `network_security_config.xml` blocks cleartext in release builds, debug-only carve-out for 10.0.2.2 / localhost. `TokenStore` now uses `EncryptedSharedPreferences` (AES-256-GCM values, AES-256-SIV keys, master key in the Android Keystore). One-shot migration from the legacy plaintext file; Keystore-failure fallback to a separate plain file with a loud warning.

---

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| **Push provider** | FCM directly | Reuses existing driver, lower lock-in than OneSignal. |
| **Email provider** | SES via dependency-free SigV4 (PR-NOTIFY-2) | Avoid pulling `@aws-sdk/client-ses` into the bundle for a single API call. SendGrid + Postmark plug-in points kept. |
| **Background worker** | In-process Postgres polling (1.5s SKIP LOCKED) | No new infra. BullMQ swap-in is a 1-PR follow-up. |
| **Foundation cache** | In-memory TTL Map (10s flags, 60s settings) | Matches Redis-without-PUBSUB SLA. |
| **TOTP library** | None — direct RFC 6238 impl in `auth/totp.ts` | 30 lines of well-specified math; supply-chain hygiene. |
| **KYC storage / scanner / cipher** | Interface adapters (disk + stub scanner + local key in dev) | Env-var swap-ins (`KYC_STORAGE_DRIVER=s3`, etc.) — infra PRs flip them. |
| **EICAR scanner test** | Stub scanner trips on the canonical EICAR string | Lets the integration test prove "infected → no persistence" without dragging in real ClamAV. |
| **RG raise-limit cool-off** | 24h staging via `pendingLimits` JSON + `pendingActivatesAt` | Lower instant, raise deferred. Lazy scheduler — promotes on next `getProfile` / heartbeat. |
| **Profile moderation** | Hard-block + flag-and-queue split | Profanity stays hard-blocked. Borderline patterns flag-and-queue for admin eyes. |
| **Trusted-device cookie** | sha256 hashed in DB, plaintext delivered once | Same pattern as the password-reset token. DB leak ≠ session takeover. |
| **Impersonation JWT** | Same shape as a normal session, with `purpose: 'impersonation'` + `actorId` | Downstream code Just Works; audit writers see `actorId` to record who's really behind the wheel. |
| **Referral payout** | Two `BET_WALLET_CREDIT` outbox rows with `referral:<claimId>:{referrer,referee}` keys | Atomic with the QUALIFIED transition; idempotent on retry. |
| **Order address snapshot** | Full JSON copy at `setShippingAddress` time | Decouples shipping from later edits / soft-deletes of the source row. |
| **Ticket SLA** | Per-priority via SystemSetting (URGENT=60min default) | Support can re-tune without a deploy. First admin public reply stamps `firstResponseAt`. |
| **Recon scope** | Whole-history `localSum` vs current `remoteSum`, not per-day delta | Per-day delta misses old missed events. Whole-history compare catches drift immediately. |
| **Recon balance failure** | Logged as discrepancy with notes, not aborted | Single user-balance HTTP failure shouldn't take down the entire nightly run. |
| **Fraud cluster window** | 30d for IP/device, 24h for referrer velocity | Different abuse patterns: shared infra is multi-week, fast-referrer-fraud is hours. |
| **Fraud severity ladder** | 1× threshold = LOW, 2× = MEDIUM, 5× = HIGH | Single mental model across all rules; queue sorts cleanly on it. |
| **Fraud auto-action** | None — humans review | Auto-block lands in PR-FRAUD-2 with a manual-review queue. |
| **CSV export streaming** | Async-iterator + 500-row Prisma pages + 1M-row cap | Bounded heap; 100k+ row dumps don't OOM. Cap forces narrower windows above 1M. |
| **CSV BOM prefix** | Always | Excel on Windows otherwise mangles ₹ + Hindi characters. |
| **CSV import default** | Dry-run; commit requires explicit `?dryRun=false` | A misclick on a 10k-row CSV could wipe a table. Default-safe wins. |
| **CSV import partial commits** | Refused — all-or-nothing | Operator mental model stays clean: "I uploaded X rows, X rows landed". |
| **Promo discount math** | PERCENT floors to integer paise, FLAT caps at base price (no negative) | Predictable: never charge ₹0.4999, never refund more than the order value. |
| **Promo validate vs redeem split** | Pure validate is unauthenticated-of-effect | A misbehaving client calling validate 1000 times can't affect the per-user cap. |
| **Promo soft over-count tolerance** | Worst case 1 extra redemption per cap | Race window between validate + redeem is tiny; full row-locking would complicate the schema for negligible gain. |
| **Analytics charting** | Plain divs + tables, no library | Admin bundle stays tiny. Funnel bars are CSS widths; retention is intensity-coded backgrounds. |
| **Cohort week anchor** | UTC Monday | DST-stable. Aligned to most analytics tools' default. |
| **Share page** | Separate `/share/[id]` route, not the auth'd auction detail | Crawlers prefer minimal markup; future `?ref=` attribution is cleaner on a stand-alone route. |
| **CSRF / admin SPA tokens** | HttpOnly + SameSite=Lax cookie (PR-ADMIN-COOKIE-AUTH) | XSS can't read the JWT; SameSite=Lax kills CSRF without needing tokens. Bearer path retained for mobile. |
| **AWS SDK on the backend** | Inline SigV4 (`backend/src/aws/sigv4.ts`) shared across SES + S3 + KMS | ~50 lines of well-specified math vs ~12 MB of `@aws-sdk/*` + peer deps. Same supply-chain hygiene we used for TOTP. |
| **KMS envelope vs direct Encrypt** | Envelope (KMS `GenerateDataKey` for the DEK, AES-256-GCM locally) | Direct KMS has a 4 KiB plaintext limit + per-call cost; envelope is ~100× cheaper at our payload sizes and matches AWS's own pattern (S3 SSE-KMS). |
| **ClamAV protocol** | Native INSTREAM TCP, no client lib | The protocol is ~80 lines to implement; every npm wrapper either pulls in stale deps or hasn't been touched in 5y. |
| **Worker leader election** | None yet — `replicas: 1` for the worker pod | Postgres SKIP LOCKED protects data; only @Cron side-effects (e.g. queueing duplicate emails) would double on replicas > 1. PR-LEADER-ELECT lifts this constraint. |
| **Android cert pinning** | System CA store; deferred ISRG root pinning | Pinning needs a CA-rotation runbook + a release cadence that can handle an emergency pin drop. Cleartext block (#72) is the load-bearing fix. |
| **`AdminAuditLog` retention** | 7 years, archive to Glacier after 2y | Financial compliance (separate background job PR). |
| **Self-ADMIN-revoke** | Server-side block | Prevents self-lockout footgun. |

---

## File structure

Annotated tree of the new top-level directories shipped this cycle. See prior CONTEXT.md revisions for the full layout.

```
backend/src/
├── aws/sigv4.ts               ← shared SigV4 signer (NOTIFY-2 + INFRA-S3-1 + INFRA-KMS-1)
├── auth/cookie.ts             ← ADMIN-COOKIE-AUTH zero-dep cookie helpers
├── notifications/
│   └── sns-signature-verifier.ts  ← NOTIFY-3 RSA verifier (zero-dep)
├── kyc/
│   ├── kyc-storage.ts         ← KycStorage interface + S3KycStorage impl (INFRA-S3-1)
│   ├── virus-scanner.ts       ← VirusScanner interface + ClamAvVirusScanner (INFRA-CLAMAV-1)
│   └── document-cipher.ts     ← DocumentCipher interface + KmsDocumentCipher (INFRA-KMS-1)
├── storage/                   ← BULK-IMG-1 generic Storage + SharpImageProcessor
├── tickets/                   ← TICKETS-1
├── reconciliation/            ← RECON-1
├── fraud/                     ← FRAUD-1 + FRAUD-2
├── csv/                       ← CSV-1 (export) + CSV-2 (import + parser)
├── analytics/                 ← ANALYTICS-1
├── campaigns/                 ← CAMPAIGN-1

admin/src/
├── lib/cookie auth surface    ← ADMIN-COOKIE-AUTH (auth.ts → user-only sessionStorage; api.ts → credentials:include)
├── pages/
│   ├── Tickets.tsx            ← TICKETS-1
│   ├── Reconciliation.tsx     ← RECON-1
│   └── Analytics.tsx          ← ANALYTICS-1

app/src/main/
├── res/xml/network_security_config.xml      ← ANDROID-SECURITY (cleartext blocked)
├── java/.../data/auth/TokenStore.kt         ← EncryptedSharedPreferences (ANDROID-SECURITY)

auctions/app/
├── share/[id]/                ← SHARE-1 (public, no auth)
├── me/support/                ← TICKETS-1 (list + new ticket)
└── me/support/[id]/           ← TICKETS-1 (thread)

helm/kalki/templates/
├── backend.yaml               ← + KYC_*/CLAMD_* env wiring conditional on values
├── backend-worker.yaml        ← WORKER-EXTRACT (Recreate strategy, KALKI_ROLE=worker)
└── clamav.yaml                ← INFRA-CLAMAV-1 (clamav/clamav:1.3 + freshclam + PVC)
```

Backend migrations shipped in Q2: none beyond Month-4. The infra work is code + Helm only — no schema changes.

---

## What's left to do

**The 27 product features + the Q2 hardening triplet + late audit follow-ups are all shipped or in review.** What remains is operational, not engineering:

### Immediate (operator-driven)

- [ ] Merge the 5 open Q2 PRs (#68–#72). All CLEAN/MERGEABLE; orthogonal — no merge-order dependency.
- [ ] Flip the prod env vars to activate the new infra:
  - `KYC_STORAGE_DRIVER=s3` + `AWS_REGION` + AWS creds → INFRA-S3-1 goes live.
  - `KYC_VIRUS_SCANNER=clamav` + `clamav.enabled=true` in the Helm overlay → INFRA-CLAMAV-1 goes live.
  - `KYC_CIPHER_DRIVER=kms` + `kyc.cipher.driver=kms` in the Helm overlay → INFRA-KMS-1 goes live.
  - `NOTIFY_SNS_VERIFY=true` → NOTIFY-3 hardens the webhook.
  - `CORS_ALLOWED_ORIGINS=https://kalki-admin.cloud.podstack.ai` → ADMIN-COOKIE-AUTH goes live on the SPA.
- [ ] Build + ship a release-build Android APK that uses the new TLS-only + EncryptedSharedPreferences code path.

### Follow-up backlog (not blocking ship)

- [ ] **PR-LEADER-ELECT** — Postgres advisory-lock or Redis SETNX leader election for the worker pod, so `replicas: 2+` runs the @Cron jobs once not twice. Today's safety mechanism is `replicas: 1` + `Recreate` strategy.
- [ ] **PR-ANDROID-CERT-PIN** — Pin the ISRG Root X1 (Let's Encrypt) in the network security config. Needs a CA-rotation runbook. Not blocking — system-CA trust is the right default until we have a release cadence that can handle a CA-rotation emergency drop.
- [ ] **PR-RAZORPAY-WEBHOOK** — Razorpay payment-status webhook handler. Within reach now that SES domain verification (PR-NOTIFY-2) is wired — the same SigV4 pattern applies.
- [ ] **PR-NOTIFY-3-cache-ttl** — Add a 1-day TTL to the SNS cert cache so a SNS-driven cert rotation doesn't pin us to the old cert until process restart. Restart frequency on our deploy cadence (~1/day) mitigates this; not urgent.
- [ ] **PR-RECON-BATCH** — Per-batch endpoint on Bet's side so the nightly recon doesn't do N HTTP calls. Worth it at ~500k users; today's 5k-user sweep finishes in seconds.
- [ ] **PR-MEILI-SEARCH** — Postgres ILIKE → MeiliSearch when admin user-search latency creeps past 200ms (today: well under).

---

## How to pick this up

```bash
git fetch origin
git checkout main
git pull
```

### Current review queue

The 5 open PRs (#68–#72) are all CLEAN/MERGEABLE. They're fully orthogonal — different files, different surfaces. Merge in any order; no rebase cascade to manage.

| PR | Touches | Conflict surface |
|---|---|---|
| #68 INFRA-CLAMAV-1 | `backend/src/kyc/virus-scanner.*`, `helm/kalki/templates/clamav.yaml`, `helm/kalki/templates/backend.yaml`, `values.yaml` | helm files overlap with the other infra PRs but the edits target distinct sections |
| #69 INFRA-KMS-1 | `backend/src/kyc/document-cipher.*`, `helm/kalki/templates/backend.yaml`, `values.yaml` | helm overlap (same section as #68; merge one then the other auto-rebases cleanly) |
| #70 NOTIFY-3 | `backend/src/notifications/*` | none |
| #71 ADMIN-COOKIE-AUTH | `backend/src/auth/*` + `backend/src/main.ts` + admin SPA | none |
| #72 ANDROID-SECURITY | `app/**` | none (Android repo path is separate) |

Suggested order: merge anything first; if helm conflicts appear on #68/#69 use the "Take BOTH" pattern that's been the convention through this whole program.

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
  "UPDATE \"FeatureFlag\" SET enabled = true WHERE id = 'reconciliation.enabled';"
```

### Tests + typechecks

```bash
cd backend && npx tsc --noEmit && npx jest        # 640/640 passing on this batch
cd auctions && npx tsc --noEmit
cd admin && npx tsc --noEmit && npx vite build
```

---

## Open architecture questions

From [`PRODUCTION_ROADMAP.md`](PRODUCTION_ROADMAP.md):

1. **FCM vs OneSignal vs custom** for push at scale. Currently FCM; revisit at 100k DAU.
2. **Self-hosted ClamAV vs AWS Macie/GuardDuty** for KYC virus scanning. **Settled**: self-hosted (in-cluster) per PR-INFRA-CLAMAV-1 (#68). Trade-off: keeps PII inside the VPC; daemon is RAM-heavy (~1 GB resident).
3. **MeiliSearch for user search** at > 1M users. Currently Postgres ILIKE.
4. **Hot vs cold KYC document storage**. Currently planned hot for first year.
5. **Aadhaar last-4 only vs full**. Currently last-4 (`AADHAAR_LAST4` enum).
6. **In-app notification retention**. Currently 90 days planned.
7. **`db push --accept-data-loss` removal**. Currently kept with self-healing cleanup.
8. **Worker scale-out trigger**. In backend pod until queue depth > 10k or worker CPU > 60%.
9. **Redis cache layer**. Currently in-memory `TtlCache`; promote when multi-pod cache invalidation matters.
10. **SNS webhook signature verification**. **Settled**: full RSA verification shipped in PR-NOTIFY-3 (#70). Activated by `NOTIFY_SNS_VERIFY=true`.
11. **Dedicated `COMPLIANCE` role**. KYC review currently squats on `FINANCE`. Splits when the next RBAC refactor adds the enum value.
12. **`order.*` permission slug family**. Order ops currently re-use `withdrawal.*` slugs. Dedicated slugs land when ops staffing gets a separate role.
13. **Recon batch API on Bet**. Today we do N HTTP calls per recon run. At 500k+ users, switch to a per-batch endpoint on Bet's side.
14. **Promo per-user cap concurrency**. Soft over-count of 1 accepted. Tighten only if abuse data shows it.

---

## Where the audit findings stand

| Finding | Status |
|---|---|
| #1 Schema drift on `Auction.startsAt` | ✅ Fixed in #27 |
| #2 Stuck `_prisma_migrations` row | ✅ Self-healing init container in #27 |
| #3 Postgres password in git | 📝 Documented runbook; rotation pending |
| #4 Admin SPA localStorage JWT | ✅ Shipped in #71 (ADMIN-COOKIE-AUTH); awaiting merge + env flip |
| #5 Android cleartext HTTP | ✅ Shipped in #72 (ANDROID-SECURITY); awaiting merge + release build |
| #6 Android plaintext token storage | ✅ Shipped in #72 (ANDROID-SECURITY); awaiting merge + release build |
| #7 Razorpay webhook missing | ⏳ Backlog (PR-RAZORPAY-WEBHOOK); same SigV4 pattern as NOTIFY-2 |
| #8 Bid placement cross-service consistency | ✅ Fixed in PR-OUTBOX-1 (#31) |
| #9 Aviator double-tap | ✅ Fixed in #28 |
| #10 Aviator wallet drift | ✅ Fixed in #28 |
| #11 Login throttle | ✅ Fixed in #28 |
| #12 NO_WINNER ringmaster cascade | ⏳ Backlog, low priority |
| #13 `db push --accept-data-loss` fallback | 📝 Documented; deferred |

---

*End of context. Refresh this file after each batch of PRs lands so the next session can pick up cold.*
