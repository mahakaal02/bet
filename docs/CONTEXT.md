# Project Context — engineering handoff

**As of 2026-05-21**

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

### Currently OPEN (review queue)

| PR | Title | State |
|---|---|---|
| [#40](https://github.com/mahakaal02/bet/pull/40) | **PR-DAILY-1** | Daily login streak rewards (26h grace window, freeze-spend math, 30-day cycle) |
| [#41](https://github.com/mahakaal02/bet/pull/41) | **PR-EMAIL-1** | Email change w/ double-confirm (24h expiry, sha256 token hashes) |
| [#42](https://github.com/mahakaal02/bet/pull/42) | **PR-ADDRESS-1** | Shipping addresses CRUD (default-selection invariants, soft delete) |

All three open PRs are CLEAN/MERGEABLE post-rebase. Three rebase passes were needed as the upstream RG-1 + 2FA-1 merges shifted the same anchor points (auth.module.ts, app.module.ts, profile/page.tsx).

### Feature flags currently in the DB (all default OFF)

| Flag | Effect when ON |
|---|---|
| `notifications.enabled` | Notification worker drains PENDING rows + dispatches |
| `watchlist.enabled` | Watchlist REST endpoints exposed |
| `watchlist.outbid_notifications` | `OutbidListenerService` fires when bids displace watchers |
| `outbox.enabled` | Outbox worker drains rows |
| `outbox.bid_wallet_debit` | `BidsService.placeBid()` uses outbox path vs legacy sync-HTTP |

Settings catalog (13 rows) seeded by `20260520180000_settings_catalog/` — admins can tune live via the SETTINGS-1 UI.

---

## Roadmap progress

**At PR-level: 20 / 36 PRs shipped (19 merged + 3 open). 16 PRs remaining.**
**At feature-level: ~16 / 27 features substantially covered.**

| Month | Done | Status |
|---|---|---|
| Month 1 (foundation + auth + roles) | **7 / 7** | ✅ Foundation, NOTIFY-1, OUTBOX-1, AUDIT-1, RBAC-1, MODERATOR-1, SETTINGS-1 |
| Month 2 (compliance + responsible) | **3 / 7** | PWRESET-1, 2FA-1, RG-1 done; remaining: KYC-1, KYC-2, RG-2, 2FA-2 |
| Month 3 (engagement) | **4 / 8** | WATCHLIST-1 done + DAILY-1 / EMAIL-1 / ADDRESS-1 open; remaining: NOTIFY-2, PROFILE-1, PROFILE-2, REFERRAL-1, ORDER-1 |
| Month 4 (trust + admin) | **0 / 10** | TICKETS-1, RECON-1, FRAUD-1, CSV-1, CSV-2, SHARE-1, ANALYTICS-1, CAMPAIGN-1, DELETION-1 |
| Q2 (hardening) | **0 / 4** | FRAUD-2, IMPERSONATE-1, BULK-IMG-1, WORKER-EXTRACT |

Cumulative test count: **222 backend tests passing** (was 105 going into this session).

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
- **RG-1**: Responsible-gambling limits + cool-down + self-exclusion. Lower-instant / raise-refused. Login + bid gates. `rg_*` notification templates bypass marketing opt-outs (regulatory carve-out). 24 new tests.

### Phase 9 — Engagement + lifecycle (#40, #41, #42, open)

- **DAILY-1**: streak math (26h grace, freeze-spend at streak ≥ 7), wallet credit outside Prisma tx (retry-idempotent under `daily_login:<claim.id>`). 22 new tests.
- **EMAIL-1**: double-confirm email change with two sha256 tokens (one each side), 24h expiry, `User.email` updated atomically with `appliedAt`. New `EmailAdapter.sendDirect()` for addresses not on the user row. 15 new tests.
- **ADDRESS-1**: CRUD with default-selection invariants (first-auto, single tx demote-then-promote, refuse-unflag-only-default, soft-delete auto-promote). PII-at-rest hook in place as passthrough stubs. 21 new tests.

---

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| **Push provider** | FCM directly | Reuses existing driver, lower lock-in than OneSignal. |
| **Email provider** | Interface w/ stub/ses/sendgrid plug-ins, stub default | No AWS creds yet — pipeline works end-to-end in dev. |
| **Background worker** | In-process Postgres polling (1.5s SKIP LOCKED) | No new infra. BullMQ swap-in is a 1-PR follow-up. |
| **Foundation cache** | In-memory TTL Map (10s flags, 60s settings) | Matches Redis-without-PUBSUB SLA; Redis swap is pure infra. |
| **Foundation services DI** | `PrismaService` (singleton from PrismaModule) | Matches the rest of the backend. |
| **Outbox `MAX_ATTEMPTS`** | 7 (six retries before DEAD) | Last backoff slot (12h) is reachable per docs. |
| **`AdminAuditLog` retention** | 7 years, archive to Glacier after 2y | Financial compliance (separate background job PR). |
| **Self-ADMIN-revoke** | Server-side block | Prevents self-lockout footgun. |
| **CSRF / admin SPA tokens** | localStorage today, plan for httpOnly cookies | Deferred to PR-ADMIN-COOKIE-AUTH (Q2). |
| **TOTP library** | None — direct RFC 6238 impl in `auth/totp.ts` | 30 lines of well-specified math; supply-chain hygiene. 5 RFC vectors pinned in tests. |
| **TOTP secret encryption** | AES-256-GCM via `auth/secret-cipher.ts` | Key from `TOTP_SECRET_ENCRYPTION_KEY` → `JWT_SECRET` fallback. Throws on prod boot if neither is set. |
| **RG raise-limit** | Refuse (current behaviour) — defer 24h cool-off to PR-RG-2 | Lower direction = the whole point of RG, works instantly. Raise needs a `pendingValue` schema migration. |
| **RG check on every JWT validation** | Yes | Self-exclusion wouldn't be effective if a stale JWT could still bid. |
| **Daily-login wallet credit** | Outside the Prisma `$transaction` | Avoids rolling back the claim if the wallet host is briefly down. `daily_login:<claim.id>` keeps retries idempotent. |
| **Email-change tokens** | Two distinct tokens, sha256 hash only on DB | Possession-of-both-mailboxes is the real defence; storing only hashes survives DB leak. |
| **Address PII at rest** | Passthrough stub today | `SecretCipher` (PR-2FA-1) is the swap target; isolated to two helpers (`encryptRow`/`decryptRow`) so PR-ADDRESS-PII is a 30-line change. |

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
│   ├── schema.prisma               ← 45 tables, 22 enums
│   └── migrations/
│       ├── … (foundation, notify_seed, outbox_seed, settings_catalog)
│       ├── 20260521000000_2fa_seed                ← 2FA-1
│       ├── 20260521010000_rg_seed                 ← RG-1
│       ├── 20260521020000_daily_login_seed        ← DAILY-1 (open)
│       └── 20260521030000_email_change_seed       ← EMAIL-1 (open)
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
│   │   ├── auth.service.ts                         ← RG gate + 2FA challenge composition
│   │   ├── password-reset.service.ts               ← PWRESET-1
│   │   ├── totp.ts + secret-cipher.ts              ← 2FA-1
│   │   ├── two-factor.service.ts                   ← 2FA-1
│   │   ├── email-change.service.ts                 ← EMAIL-1 (open)
│   │   └── (controllers + specs)
│   │
│   ├── admin/
│   │   ├── admin.controller.ts
│   │   ├── audit.controller.ts                     ← Perm('audit.view')
│   │   ├── roles.controller.ts                     ← RBAC-1
│   │   ├── settings.controller.ts                  ← SETTINGS-1
│   │   ├── feature-flags.controller.ts             ← SETTINGS-1
│   │   ├── permissions.ts + perms.guard.ts         ← MODERATOR-1
│   │   └── admin.module.ts
│   │
│   ├── notifications/                              ← NOTIFY-1
│   │   ├── notification-worker.ts
│   │   ├── notification-broadcast.gateway.ts
│   │   ├── template-renderer.ts
│   │   ├── outbid-listener.service.ts
│   │   └── adapters/ (inapp, push, email — w/ sendDirect)
│   │
│   ├── watchlist/                                  ← WATCHLIST-1
│   ├── responsible-gambling/                       ← RG-1
│   ├── daily-login/                                ← DAILY-1 (open)
│   └── addresses/                                  ← ADDRESS-1 (open)
│
auctions/                                            ← Next.js public surface
└── app/
    ├── login/LoginForm.tsx                         ← 2FA two-step + Forgot link
    ├── auth/
    │   ├── forgot/                                 ← PWRESET-1
    │   ├── reset/                                  ← PWRESET-1
    │   └── email-change/confirm/                   ← EMAIL-1 (open)
    ├── me/
    │   ├── 2fa/                                    ← 2FA-1
    │   ├── rg/                                     ← RG-1
    │   ├── daily/                                  ← DAILY-1 (open)
    │   ├── email/                                  ← EMAIL-1 (open)
    │   ├── addresses/                              ← ADDRESS-1 (open)
    │   └── watchlist/                              ← WATCHLIST-1
    ├── notifications/                              ← NOTIFY-1
    ├── profile/page.tsx                            ← cards added per PR
    └── api/                                        ← thin proxies for each /me/* endpoint

admin/                                               ← Vite SPA
└── src/pages/
    ├── AuditLog.tsx                                ← AUDIT-1
    ├── Roles.tsx                                   ← RBAC-1
    ├── Settings.tsx                                ← SETTINGS-1
    └── FeatureFlags.tsx                            ← SETTINGS-1
```

---

## What's left to do

Per [`PRODUCTION_ROADMAP.md`](PRODUCTION_ROADMAP.md). **16 PRs remaining.**

### Month 2 remainder (4)

- [ ] **PR-KYC-1** — Tier system (TIER_0 → TIER_3), document upload, encryption at rest (KMS), virus scan via ClamAV, withdrawal gating per tier.
- [ ] **PR-KYC-2** — Admin manual review queue.
- [ ] **PR-RG-2** — Session reminders (WebSocket), aviator pre-bet hook, 24h-cool-off for raise-limit.
- [ ] **PR-2FA-2** — Trusted device cookie (90d), recovery flow.

### Month 3 remainder (5)

- [ ] **PR-NOTIFY-2** — SES driver wired, bounces/complaints webhook, full event family expansion.
- [ ] **PR-PROFILE-1** — Avatar upload + display name + reserved names + profanity filter.
- [ ] **PR-PROFILE-2** — Admin moderation queue for flagged profiles.
- [ ] **PR-REFERRAL-1** — Claim flow + qualification job + payout via outbox.
- [ ] **PR-ORDER-1** — Order tracking lifecycle (PENDING_ADDRESS → AWAITING_FULFILLMENT → IN_TRANSIT → DELIVERED → DISPUTED). Chains off ADDRESS-1.

### Month 4 (9)

- [ ] PR-TICKETS-1, PR-RECON-1, PR-FRAUD-1, PR-CSV-1, PR-CSV-2, PR-SHARE-1, PR-ANALYTICS-1, PR-CAMPAIGN-1, PR-DELETION-1.

### Quarter 2 (4)

- [ ] PR-FRAUD-2, PR-IMPERSONATE-1, PR-BULK-IMG-1, PR-WORKER-EXTRACT (infra). Plus PR-ADMIN-COOKIE-AUTH from the audit findings.

---

## How to pick this up

```bash
git fetch origin
git checkout main
git pull
```

The next batch sequenced for "Day 2" work:
- **PR-2FA-2** — small, completes the 2FA story (trusted device cookie).
- **PR-PROFILE-1** — medium, unlocks PROFILE-2.
- **PR-DELETION-1** — medium, compliance-critical (GDPR/DPDP).
- **PR-IMPERSONATE-1** — small admin tool, audit-friendly.

### Pull current state

The three open PRs (#40 / #41 / #42) are CLEAN/MERGEABLE. Merge order doesn't matter — the conflict patterns I resolved already produce a coherent post-merge tree no matter which lands first.

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
  "UPDATE \"FeatureFlag\" SET enabled = true WHERE id = 'notifications.enabled';"
```

### Tests + typechecks

```bash
cd backend && npx tsc --noEmit && npx jest
cd auctions && npx tsc --noEmit
cd admin && npx tsc --noEmit
```

---

## Open architecture questions

From [`PRODUCTION_ROADMAP.md`](PRODUCTION_ROADMAP.md):

1. **FCM vs OneSignal vs custom** for push at scale. Currently FCM; revisit at 100k DAU.
2. **Self-hosted ClamAV vs AWS Macie/GuardDuty** for KYC virus scanning. Currently planned self-hosted.
3. **MeiliSearch for user search** at > 1M users. Currently Postgres ILIKE.
4. **Hot vs cold KYC document storage**. Currently planned hot for first year.
5. **Aadhaar last-4 only vs full**. Currently last-4.
6. **In-app notification retention**. Currently 90 days planned.
7. **`db push --accept-data-loss` removal**. Currently kept with self-healing cleanup.
8. **Worker scale-out trigger**. In backend pod until queue depth > 10k or worker CPU > 60%.
9. **Redis cache layer**. Currently in-memory `TtlCache`; same SLA as Redis-without-PUBSUB. Promote when multi-pod cache invalidation matters.

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
| #7 Razorpay webhook missing | ⏳ TBD — needs SES domain verification first |
| #8 Bid placement cross-service consistency | ✅ Fixed in PR-OUTBOX-1 (#31) |
| #9 Aviator double-tap | ✅ Fixed in #28 |
| #10 Aviator wallet drift | ✅ Fixed in #28 |
| #11 Login throttle | ✅ Fixed in #28 |
| #12 NO_WINNER ringmaster cascade | ⏳ Backlog, low priority |
| #13 `db push --accept-data-loss` fallback | 📝 Documented; deferred |

---

*End of context. Refresh this file after each batch of PRs lands so the next session can pick up cold.*
