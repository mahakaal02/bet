# Project Context — engineering handoff

**As of 2026-05-23**

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

### Currently OPEN (review queue)

| PR | Title | Summary |
|---|---|---|
| [#55](https://github.com/mahakaal02/bet/pull/55) | **PR-TICKETS-1** | Support ticket inbox — user submit (anti-dup-per-category), admin reply (first-response stamps SLA hit), assign / escalate / close, internal notes hidden from user. 17 unit tests. |
| [#56](https://github.com/mahakaal02/bet/pull/56) | **PR-RECON-1** | Nightly cron compares local `CoinTransaction` sums vs Bet wallet balance. ReconciliationReport unique on forDate → cron retries are no-ops. Single-user balance failure ≠ abort. Admin SPA with ack workflow. 12 unit tests. |
| [#57](https://github.com/mahakaal02/bet/pull/57) | **PR-FRAUD-1** | Velocity (per-user bid bursts) + cluster (shared IP / device / referrer across users) detectors → `FraudSignal` table. Severity scales with how-far-over-threshold. Dedup-per-window. Admin queue for review. 16 unit tests. |
| [#58](https://github.com/mahakaal02/bet/pull/58) | **PR-CSV-1** | Admin CSV exports (audit log, coin transactions, orders). Streaming async-iterator with cursor pagination + 1M-row safety cap. UTF-8 BOM for Excel. RFC 4180 escape helpers. 15 unit tests. |
| [#59](https://github.com/mahakaal02/bet/pull/59) | **PR-CSV-2** | Bulk admin imports for coin packs + auctions (stacked on #58). Zero-dep RFC 4180 parser. Dry-run-by-default → operator reviews diff before commit; one Prisma tx per commit. 21 unit tests (parser + import). |
| [#60](https://github.com/mahakaal02/bet/pull/60) | **PR-SHARE-1** | Public no-auth `/share/[id]` page with OpenGraph + Twitter Card meta. Re-uses the already-public `GET /auctions/:id` — zero backend changes. |
| [#61](https://github.com/mahakaal02/bet/pull/61) | **PR-ANALYTICS-1** | Admin dashboard: 6-step funnel (signup → bid) + weekly cohort retention. No charting lib — plain divs + tables. 9 unit tests. |
| [#62](https://github.com/mahakaal02/bet/pull/62) | **PR-CAMPAIGN-1** | Coin-pack promo codes (PERCENT or FLAT) with lifetime + per-user caps, optional CoinPack allowlist, expiry. Pure dry-run validate / redeem split for replay safety. 21 unit tests. |

All 8 open PRs are CLEAN/MERGEABLE at the time of writing (#59 is stacked on #58 — base = `claude/csv-1`). Cumulative backend test count: **518 passing** (was 386 going into the Month-4 batch).

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

**At PR-level: 35 / 36 PRs shipped (27 merged + 8 open). 1 PR-class remains (infra triplet).**
**At feature-level: ~27 / 27 features substantially covered.** 🎉

| Month | Done | Status |
|---|---|---|
| Month 1 (foundation + auth + roles) | **7 / 7** | ✅ Foundation, NOTIFY-1, OUTBOX-1, AUDIT-1, RBAC-1, MODERATOR-1, SETTINGS-1 |
| Month 2 (compliance + responsible) | **7 / 7** | ✅ PWRESET-1, 2FA-1, 2FA-2, RG-1, RG-2, KYC-1, KYC-2 |
| Month 3 (engagement) | **9 / 9** | ✅ WATCHLIST-1, DAILY-1, EMAIL-1, ADDRESS-1, PROFILE-1, NOTIFY-2, PROFILE-2, REFERRAL-1, ORDER-1 |
| Month 4 (trust + admin) | **10 / 10** | ✅ DELETION-1 + IMPERSONATE-1 (Day-2) + TICKETS-1, RECON-1, FRAUD-1, CSV-1, CSV-2, SHARE-1, ANALYTICS-1, CAMPAIGN-1 (this batch) |
| Q2 (hardening) | **0 / 3** | FRAUD-2, BULK-IMG-1, WORKER-EXTRACT — explicitly Q2 |

Cumulative backend test count: **518 passing** (Day 1: 222 → Day 2: 376 → Day 3: 386 → Day 4: **518**). +132 tests in this Month-4 batch.

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

### Phase 11 — Month-4 trust + admin batch (#55–#62, OPEN review queue)

- **TICKETS-1** — Support ticket inbox. User /me/support with anti-duplicate-per-category; admin queue with SLA-warmest-first sort + internal notes hidden from user. First admin public reply stamps `firstResponseAt` for SLA hit-rate analytics. 17 tests.
- **RECON-1** — Nightly local-vs-Bet wallet reconciliation. Per-user `localSum` (CoinTransaction sum) vs `remoteSum` (Bet balance) → `ReconciliationDiscrepancy` rows for non-zero drift. `BalanceFetcher` interface keeps the service unit-testable + lets us swap in a batch endpoint later. Idempotent on `forDate`. Admin ack workflow. 12 tests.
- **FRAUD-1** — Velocity (bid-burst per user per window) + cluster (shared IP / device / referrer) heuristics → `FraudSignal` rows. Severity scales (1×=LOW, 2×=MEDIUM, 5×=HIGH). Cron sweep at 03:00 UTC. Admin review queue. 16 tests.
- **CSV-1** — Streaming admin exports (audit log, coin transactions, orders) with cursor pagination + 1M-row safety cap. UTF-8 BOM prefix for Excel compatibility. `csvEscape` / `csvRow` RFC 4180 helpers reused by CSV-2. 15 tests.
- **CSV-2** — Bulk admin imports for coin packs + auctions. Zero-dep RFC 4180 parser. Dry-run-by-default (`?dryRun=false` required to write); one Prisma transaction per commit; refuses to write if ANY row fails validation. 21 tests.
- **SHARE-1** — Public no-auth `/share/[id]` route with OpenGraph + Twitter Card meta tags. Re-uses the already-public `GET /auctions/:id` endpoint — zero backend changes.
- **ANALYTICS-1** — Funnel (signup → email → phone → KYC ≥ TIER_1 → first deposit → first bid) + weekly cohort retention. UTC-Monday-anchored buckets. Plain divs + tables — no charting lib pulled in. 9 tests.
- **CAMPAIGN-1** — Coin-pack promo codes. PERCENT (1-100) or FLAT (paise). Lifetime + per-user caps. Optional CoinPack allowlist. Pure `validate()` / `redeem()` split keeps brute-force probes from affecting the per-user cap. 21 tests.

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
| **CSRF / admin SPA tokens** | localStorage today, plan for httpOnly cookies | Deferred to PR-ADMIN-COOKIE-AUTH (Q2). |
| **`AdminAuditLog` retention** | 7 years, archive to Glacier after 2y | Financial compliance (separate background job PR). |
| **Self-ADMIN-revoke** | Server-side block | Prevents self-lockout footgun. |

---

## File structure

Annotated tree of the new top-level directories shipped this cycle. See prior CONTEXT.md revisions for the full layout.

```
backend/src/
├── tickets/                   ← TICKETS-1
├── reconciliation/            ← RECON-1
├── fraud/                     ← FRAUD-1
├── csv/                       ← CSV-1 (export) + CSV-2 (import + parser)
├── analytics/                 ← ANALYTICS-1
├── campaigns/                 ← CAMPAIGN-1

admin/src/pages/
├── Tickets.tsx                ← TICKETS-1
├── Reconciliation.tsx         ← RECON-1
├── Analytics.tsx              ← ANALYTICS-1
(KycReview, ProfileModeration already shipped in Day-3 batch)

auctions/app/
├── share/[id]/                ← SHARE-1 (public, no auth)
├── me/support/                ← TICKETS-1 (list + new ticket)
└── me/support/[id]/           ← TICKETS-1 (thread)
```

New backend migrations (chronological):
```
20260522050000_order_relations            ← ORDER-1
20260523000000_reconciliation             ← RECON-1
20260523010000_fraud_signals              ← FRAUD-1
20260523020000_promo_codes                ← CAMPAIGN-1
```

---

## What's left to do

Per [`PRODUCTION_ROADMAP.md`](PRODUCTION_ROADMAP.md). **All 27 product features are now substantially covered.** What remains is hardening + infra:

### Quarter 2 — explicitly deferred at planning time

- [ ] **PR-FRAUD-2** — Manual review queue + admin block actions on top of FRAUD-1.
- [ ] **PR-BULK-IMG-1** — Storage abstraction (S3 + EXIF strip + resize) shared between avatars + KYC + auction images.
- [ ] **PR-WORKER-EXTRACT** — Lift the notification + outbox workers into a dedicated pod.

### Infra triplet — wires the KYC adapters' real backends

- [ ] **PR-INFRA-S3-1** — Real `S3KycStorage` impl behind the `KYC_STORAGE_DRIVER=s3` flag.
- [ ] **PR-INFRA-CLAMAV-1** — Real `ClamAvVirusScanner` impl behind `KYC_VIRUS_SCANNER=clamav`.
- [ ] **PR-INFRA-KMS-1** — Real `KmsDocumentCipher` impl behind `KYC_CIPHER_DRIVER=kms`.

### Late audit follow-ups

- [ ] **PR-NOTIFY-3** — Full SNS SigV4 signature verification on the webhook (topic-ARN gate active now).
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

The 8 open PRs (#55–#62) are all CLEAN/MERGEABLE. **#59 (CSV-2) is stacked on #58 (CSV-1)** — base is `claude/csv-1`, so merge #58 first and #59 auto-rebases onto `main`.

Suggested merge order — these PRs are largely orthogonal (different modules), so the cascade-conflict risk is low. Order by `auctions/app/profile/page.tsx` touch frequency to minimise rebase work:

1. #56 RECON-1 (no profile/page.tsx)
2. #57 FRAUD-1 (no profile/page.tsx)
3. #58 CSV-1 (no profile/page.tsx)
4. #59 CSV-2 (auto-rebases after #58)
5. #60 SHARE-1 (no profile/page.tsx)
6. #61 ANALYTICS-1 (no profile/page.tsx)
7. #62 CAMPAIGN-1 (no profile/page.tsx)
8. #55 TICKETS-1 (touches profile/page.tsx — Help card)

Last merge gets the only profile/page.tsx conflict resolution; everything else is clean.

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
cd backend && npx tsc --noEmit && npx jest        # 518/518 passing on this batch
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
9. **Redis cache layer**. Currently in-memory `TtlCache`; promote when multi-pod cache invalidation matters.
10. **SNS webhook signature verification**. Deferred to PR-NOTIFY-3 (topic-ARN gate active now).
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
| #4 Admin SPA localStorage JWT | ⏳ PR-ADMIN-COOKIE-AUTH (Q2) |
| #5 Android cleartext HTTP | ⏳ PR-ANDROID-SECURITY (Q2) |
| #6 Android plaintext token storage | ⏳ PR-ANDROID-SECURITY (Q2) |
| #7 Razorpay webhook missing | ⏳ TBD — SES domain verification needed first (now within reach after PR-NOTIFY-2) |
| #8 Bid placement cross-service consistency | ✅ Fixed in PR-OUTBOX-1 (#31) |
| #9 Aviator double-tap | ✅ Fixed in #28 |
| #10 Aviator wallet drift | ✅ Fixed in #28 |
| #11 Login throttle | ✅ Fixed in #28 |
| #12 NO_WINNER ringmaster cascade | ⏳ Backlog, low priority |
| #13 `db push --accept-data-loss` fallback | 📝 Documented; deferred |

---

*End of context. Refresh this file after each batch of PRs lands so the next session can pick up cold.*
