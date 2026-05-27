# Backend Architecture Audit

**Scope:** `backend/src/` (NestJS · 228 TS files · 33 feature modules · 46 controllers · 41 services)
**Date:** 2026-05-27
**Stance:** Audit-first. No code edits until items are approved.

---

## TL;DR

The backend is **already organized along sound NestJS feature-module lines**, not in need of the layered (`routes/controllers/services/middleware/...`) reorganization originally proposed. Forcing that template would touch ~200 files for negative gain (Nest DI, testing, schematics all assume feature modules; the recent `feat(telegram): go live` merge would be at risk).

The **real** problems are surgical:

1. `aviator.service.ts` is a 1,412-LOC god-class with **zero service-level tests**.
2. Aviator cashout does payout math in **JS Number** instead of Decimal.
3. **No global exception filter / no standardized response envelope.**
4. **Three RBAC guards coexist** (legacy `AdminGuard` + `RolesGuard` + `PermsGuard`); five high-risk admin controllers are still on the legacy bit.
5. **Audit-log coverage is inconsistent** — some admin mutations call `audit.record()` explicitly, others rely on an interceptor.
6. **Impersonation has no wallet/payments scope gate** — an impersonated session has full write power (topups, withdrawals).
7. Aviator round state is **in-memory only** — single-replica ceiling, unrelated to `KALKI_ROLE=worker` split.
8. Two parallel Razorpay route namespaces (`/payments/verify` vs `/wallet/topup/verify`).
9. WS auth model differs between Aviator (Socket.IO) and Bids (raw WS).
10. Several modules read `process.env` directly instead of `ConfigService`.

What's **already good** (don't break it): auth security, wallet centralization on Bet, Razorpay signature verification with idempotency, throttling on every sensitive endpoint, clean controller→service delegation, kebab-case route naming, zero `console.log` usage, comprehensive request DTOs.

---

## Part 1 · Current Architecture (Honest Assessment)

### Strengths (verified)

| Concern | Status | Evidence |
|---|---|---|
| **Wallet centralization** | ✅ Matches `UNIFIED_WALLET.md` | All credit/debit routes through `bet-wallet/bet-wallet.service.ts`; no service maintains its own balance column. Reconciliation job in `reconciliation/reconciliation.service.ts:147-157` compares local `CoinTransaction` sum vs Bet remote balance. |
| **Auth security** | ✅ No vulnerabilities found | Telegram HMAC uses `crypto.timingSafeEqual` ([telegram.service.ts:239](backend/src/auth/telegram.service.ts:239)); TOTP secrets AES-256-GCM with unique IVs ([secret-cipher.ts:37-58](backend/src/auth/secret-cipher.ts:37)); JWT invalidation via `passwordChangedAt` ([auth.service.ts:307](backend/src/auth/auth.service.ts:307)); bcrypt on passwords; 32-byte random hashed reset tokens. |
| **Throttling** | ✅ 50 `@Throttle` decorators on sensitive endpoints | login 8/min, register 3/min, pwreset 5/min, 2FA 10/min, telegram 5/min (under `register` bucket to prevent signup bypass), email-change 3/min. |
| **Razorpay** | ✅ HMAC + idempotency | Signature: `razorpay.client.ts:51-62` (HMAC-SHA256 + `timingSafeEqual`). Replay protection: unique `(reason, reference)` on `CoinTransaction` ([payments.service.ts:102-110](backend/src/payments/payments.service.ts:102)); Bet enforces the same key. |
| **Controller→service delegation** | ✅ Clean | Sampled controllers (auth, payments, wallet, profile, telegram, whatsapp, coin-packs, orders) all delegate; no DB writes or business logic in controller bodies. |
| **DTO usage** | ✅ Request DTOs everywhere | All `@Body` params typed to DTO classes; global `ValidationPipe({whitelist, transform, forbidNonWhitelisted})` in [main.ts:42](backend/src/main.ts:42). |
| **Logging** | ✅ Consistent | Zero `console.log` in `src/`; all via `new Logger(ClassName.name)`. |
| **Naming** | ✅ Predominantly kebab-case | `me/*` for authenticated user surfaces, `admin/*` for admin, `auth/*` for unauthenticated. |
| **Append-only audit pattern** | ✅ | `UserRole.revokedAt`, `ImpersonationLog.endedAt`, `AccountDeletion` row retained on purge. |
| **API/worker split** | ✅ | `KALKI_ROLE=api|worker` in [main.ts](backend/src/main.ts) with proper SIGTERM shutdown. |
| **Fairness/RNG** | ✅ Provably fair | Server seed committed (SHA256 published) before round, revealed on rotation. Crash multiplier = `HMAC-SHA256(serverSeed, clientSeed||nonce)` ([fairness.ts:47-64](backend/src/aviator/fairness.ts:47)). Server cannot pre-bias at commit time. |

### Genuine problems (prioritized)

Each item is sized **S / M / L** and tagged **risk** (what breaks if untouched) + **blast radius** (refactor cost).

---

## Part 2 · Problems (Prioritized)

### P0 — Correctness / Money

#### P0-1 · Aviator cashout uses JS Number arithmetic

- **Where:** [aviator.service.ts:614-660](backend/src/aviator/aviator.service.ts:614). `bet.amount * multiplier` is plain Number multiplication; `applyPayoutCap()` returns `payout` as a `number`.
- **Risk:** IEEE-754 drift on large stakes × high multipliers. Mitigated today by `Math.floor()` and a 2-decimal Decimal cap on `multiplier` in schema, but the math itself is in Number space.
- **Fix:** Use `Decimal` end-to-end. `Decimal(bet.amount).mul(Decimal(multiplier)).floor()`. Already a dep (`decimal.js` 10.4.3).
- **Size:** S · **Blast radius:** ~30 lines in 1 file + 1 spec.

#### P0-2 · No global exception filter / no standardized error envelope

- **Where:** No `@Catch` / `useGlobalFilters` registered. [main.ts:39-81](backend/src/main.ts:39) only adds `ValidationPipe`.
- **Today:** Nest's default response leaks `message: ['email must be an email', ...]` arrays and inconsistent shapes. Audit endpoint wraps `{items, nextCursor}`, most others return raw service objects.
- **Risk:** Wire-shape drift between clients (Android, admin SPA, iOS); harder client-side error handling; HTTPException details may leak more than intended.
- **Fix:** Add a single `AllExceptionsFilter` that produces `{ error: { code, message, details? }, requestId }`. Add a `ResponseInterceptor` that wraps success as `{ data }` (or leave raw to avoid breaking clients — see Part 5 question).
- **Size:** M · **Blast radius:** 2 new files, 1 main.ts edit. Clients **may** need updates depending on how we shape the success envelope.

#### P0-3 · Impersonation has no wallet/payments scope gate

- **Where:** [impersonation.service.ts:147-157](backend/src/impersonation/impersonation.service.ts:147) issues a standard JWT with `purpose: 'impersonation'` + `actorId`. Downstream endpoints don't differentiate.
- **Risk:** An admin impersonating user X can trigger Razorpay topups, file disputes, place real bets, request withdrawals — all logged as the user, with only a 1h TTL and an `ImpersonationLog` row as the trail.
- **Fix:** Add a `@DenyImpersonated()` decorator + a guard that reads `req.user.purpose === 'impersonation'` and 403s on wallet/payment/withdrawal/account-deletion endpoints. Whitelist read-only ops.
- **Size:** M · **Blast radius:** 1 new guard + 1 decorator + ~10 controller annotations. No client changes.

### P1 — Code health / Maintainability

#### P1-1 · `aviator.service.ts` god-class (1,412 LOC, 30 public methods, zero specs)

- **Where:** [aviator.service.ts](backend/src/aviator/aviator.service.ts). Does DB ops + business rules + WebSocket broadcasting + scheduler (ad-hoc timers) + RNG orchestration + payout math + statistics + chat moderation + admin knobs.
- **Risk:** Untestable, hard to review, single point of contagion bugs.
- **Fix:** Extract within the same `aviator/` module — **do not move out of the feature folder**:
  - `aviator/round-lifecycle.service.ts` — lines 213-469: `startBettingPhase`, `startRunningPhase`, `tick`, `crashRound`.
  - `aviator/bet-settlement.service.ts` — lines 496-733: `placeBet`, `cashout`, `cashoutInternal`.
  - `aviator/aviator.gateway.ts` — lines 130-187 + every `socket.emit(...)` site. Socket.IO concern.
  - `aviator/aviator-analytics.service.ts` — lines 790-1258: stats, finance rollup, P&L, histograms.
  - `aviator.service.ts` shrinks to ~250 LOC: composition root + admin knob accessors.
- **Size:** L · **Blast radius:** ~5 new files inside `aviator/`. No imports from outside the module change (all callers use `AviatorService.publicMethod` — we keep that facade). Tests added per extracted service.

#### P1-2 · Three RBAC guards coexist; five admin controllers still on legacy `AdminGuard`

- **Where:**
  - Legacy bit: [admin.guard.ts](backend/src/admin/admin.guard.ts) — checks `User.isAdmin` only.
  - Role-level: [foundation/roles.guard.ts](backend/src/foundation/roles.guard.ts).
  - Permission-level: [admin/perms.guard.ts](backend/src/admin/perms.guard.ts).
  - Still on `AdminGuard`: [admin.controller.ts:39-40](backend/src/admin/admin.controller.ts:39), [roles.controller.ts:45-46](backend/src/admin/roles.controller.ts:45), [settings.controller.ts:86-87](backend/src/admin/settings.controller.ts:86), [feature-flags.controller.ts:71-72](backend/src/admin/feature-flags.controller.ts:71), [uploads.controller.ts](backend/src/uploads/uploads.controller.ts).
- **Risk:** All-or-nothing access; can't grant FINANCE role permission to `withdrawal.approve` without granting full admin.
- **Fix:** Migrate the five controllers method-by-method to `@Perm('...')`. Add missing permission slugs as needed (e.g., `coin_pack.edit`, `auction.create`, `aviator.settings_edit`, `aviator.payout_cap_edit`, `aviator.seed_rotate`, `feature_flag.update`, `settings.update`, `role.grant`, `role.revoke`). Keep `AdminGuard` for now as defense-in-depth, retire later.
- **Size:** M · **Blast radius:** ~30 endpoint annotations, ~10 new permission slugs in [permissions.ts](backend/src/admin/permissions.ts).

#### P1-3 · Audit-log coverage inconsistent

- **Where:** [admin.controller.ts](backend/src/admin/admin.controller.ts) mutations (coin-packs CRUD, auctions CRUD, aviator settings/crash/payout-cap PATCH, chat delete, seed rotate) do NOT call `audit.record()` explicitly. They rely on an undocumented `audit-log.interceptor.ts` (mentioned in [audit-log.service.ts:8](backend/src/foundation/audit-log.service.ts:8) header) which the audit agent couldn't locate. SettingsController and FeatureFlagsController do call it explicitly.
- **Risk:** If the interceptor isn't actually wired, sensitive admin actions (changing payout cap, rotating fairness seed, deleting chat) are unauditable.
- **Fix:** First **verify** the interceptor exists and is registered. If not, add explicit `audit.record()` calls. If yes, document it and remove the redundant explicit calls in SettingsController/FeatureFlagsController for consistency.
- **Size:** S (verify) → M (if interceptor missing).

#### P1-4 · Aviator round state in-memory only

- **Where:** [aviator.service.ts:87-211](backend/src/aviator/aviator.service.ts:87). `phase`, `current`, `phaseTimer`, `tickTimer` are class fields. Round timing driven by `setTimeout`/`setInterval`, not `@Cron` or a distributed scheduler.
- **Risk:** Cannot horizontal-scale aviator beyond one replica. `KALKI_ROLE=worker` doesn't help because the round driver is in api-mode. If the api pod restarts mid-round, players see a hang until `bootstrapState()` recovers (does it? — needs verification).
- **Fix:** Out of scope for this audit phase. **Flag only**; tackle as separate PR after the god-class split lands (extracted `RoundLifecycleService` is the natural seam to add distributed coordination).
- **Size:** L · Deferred.

### P2 — API surface / Consistency

#### P2-1 · Two parallel Razorpay route namespaces

- **Where:**
  - `POST /payments/coin-pack/:id/order` + `POST /payments/verify` — coin pack purchases ([payments.controller.ts](backend/src/payments/payments.controller.ts)).
  - `POST /wallet/topup/order` + `POST /wallet/topup/verify` — arbitrary INR ([wallet.controller.ts](backend/src/payments/wallet.controller.ts)).
- **Risk:** Doubled surface, twice the test/audit cost; clients must pick one.
- **Fix:** Consolidate to one namespace: `POST /wallet/order` (params include optional `coinPackId`) + `POST /wallet/verify`. Deprecate `/payments/*` with HTTP 308 redirects; remove after Android + admin SPA cut over.
- **Size:** M · **Blast radius:** 1 controller (combine), 2 client repos (Android `bet/`, admin `admin/`) need URL update. **Coordination needed** — flagging as approval-required.

#### P2-2 · WebSocket auth model divergence

- **Where:**
  - Aviator (Socket.IO): JWT verified once on connect ([aviator.service.ts:139-151](backend/src/aviator/aviator.service.ts:139)), `socket.data.userId` cached.
  - Bids (raw WS): JWT verified on every `subscribe` message ([bid.gateway.ts:87](backend/src/bids/bid.gateway.ts:87)).
- **Risk:** Inconsistent revocation semantics; harder to reason about. After password reset, Aviator socket would stay alive until disconnect even though JWT is invalidated.
- **Fix:** Add a connect-time `verifyOnce` + `passwordChangedAt` check to Bids gateway; have Aviator re-check on every action (placeBet/cashout already go through REST which does verify). Lower priority — neither gateway has an active vulnerability.
- **Size:** S · **Blast radius:** 2 files.

#### P2-3 · `aviator/public` violates naming pattern

- **Where:** [public-aviator.controller.ts](backend/src/aviator/public-aviator.controller.ts) uses prefix `aviator/public`. Other public surfaces just use a flat prefix (e.g., `auctions`).
- **Risk:** Minor — clients work, just inconsistent.
- **Fix:** Either rename prefix to `public/aviator` (mirrors `/admin/*` mount-style) or merge into main `aviator/` controller with method-level `@Public()` decorator. Pick one convention and apply.
- **Size:** S.

#### P2-4 · `process.env` direct reads in KYC

- **Where:** [kyc/kyc-storage.ts](backend/src/kyc/kyc-storage.ts) (7), [kyc/document-cipher.ts](backend/src/kyc/document-cipher.ts) (6), [kyc/virus-scanner.ts](backend/src/kyc/virus-scanner.ts) (3), [kyc/kyc.module.ts](backend/src/kyc/kyc.module.ts) (3). Total 19 `process.env.*` reads in KYC source vs `ConfigService` everywhere else.
- **Risk:** Hard to mock in tests (the spec files have 17+8+5 = 30 `process.env` reads of their own to compensate); breaks the single-source-of-config pattern.
- **Fix:** Inject `ConfigService` once in each, read at instantiation. Tests stay readable.
- **Size:** S · **Blast radius:** 4 files + their spec files.

### P3 — Tests / Hygiene

#### P3-1 · Missing service-level tests

- **Where:**
  - `aviator/aviator.service.ts` — no spec (pure math has specs; the orchestrator doesn't).
  - `bids/bids.service.ts` — no spec (bidding-engine has one).
  - `auctions/auctions.service.ts` — no spec.
  - `payments/payments.service.ts` — no spec.
  - `bet-wallet/bet-wallet.service.ts` — no spec.
  - `daily-login/daily-login.service.ts` — no spec for the credit-then-claim ordering.
- **Risk:** Service-level regressions slip through. The wallet credit retry semantics in particular are critical.
- **Fix:** Add specs for each as we touch them in this refactor (P1-1 forces aviator coverage; P0-1 adds cashout precision tests).
- **Size:** L · **Blast radius:** ~6 new spec files, no source changes.

#### P3-2 · Daily-login orphan claims on Bet outage

- **Where:** [daily-login.service.ts:196-217](backend/src/daily-login/daily-login.service.ts:196). Claim row inserted; if `betWallet.credit()` fails, claim persists ("intentional — idempotent retry"). Reconciliation surfaces drift the next morning.
- **Risk:** Low under normal conditions; surfaces as user-visible drift if Bet is down at midnight UTC.
- **Fix:** Migrate to outbox pattern (same as `referrals.service.ts:235-256`). The outbox dispatcher already exists in `foundation/outbox-dispatchers/`.
- **Size:** M · **Blast radius:** 1 service, add a new `OutboxKind` enum value, 1 spec.

#### P3-3 · No response DTOs

- **Where:** Every controller. Response shape is implicit, set by service return type.
- **Risk:** Wire shape can drift silently. No OpenAPI / Swagger possible without these.
- **Fix:** **Defer.** Adding response DTOs to 46 controllers is a big LOC change for marginal value unless we adopt OpenAPI. Flag for product/eng decision.
- **Size:** XL · Deferred until OpenAPI decision.

---

## Part 3 · Proposed Architecture (Spoiler: Same Shape, Healthier)

**Keep the feature-module organization.** The current layout is what NestJS docs recommend and what the Nest authors use in their reference apps. The brief's proposed `routes/controllers/services/middleware/...` layout would split every feature across 7+ folders — net negative for navigation, code review, and bounded-context isolation.

The audit changes shape these areas inside the existing folders:

```
backend/src/
├── app.module.ts                      (unchanged)
├── main.ts                            (+1: register AllExceptionsFilter)
│
├── foundation/                        cross-cutting building blocks
│   ├── filters/                       NEW: AllExceptionsFilter
│   │   └── all-exceptions.filter.ts
│   ├── interceptors/                  NEW: ResponseInterceptor (if approved)
│   │   └── response.interceptor.ts
│   ├── decorators/                    NEW: @DenyImpersonated()
│   │   └── deny-impersonated.decorator.ts
│   ├── guards/                        NEW: ImpersonationScopeGuard
│   │   └── impersonation-scope.guard.ts
│   └── (existing files unchanged)
│
├── aviator/                           god-class split
│   ├── aviator.service.ts             (was 1,412 LOC → ~250 LOC composition root)
│   ├── round-lifecycle.service.ts     NEW (was lines 213-469)
│   ├── bet-settlement.service.ts      NEW (was lines 496-733, with Decimal math)
│   ├── aviator.gateway.ts             NEW (was lines 130-187 + emits)
│   ├── aviator-analytics.service.ts   NEW (was lines 790-1258)
│   ├── aviator.module.ts              (registers the new services)
│   └── *.spec.ts                      NEW specs for each extracted service
│
├── admin/
│   ├── permissions.ts                 (+10 new slugs)
│   ├── admin.controller.ts            (migrate to @Perm)
│   ├── roles.controller.ts            (migrate to @Perm)
│   ├── settings.controller.ts         (migrate to @Perm)
│   └── feature-flags.controller.ts    (migrate to @Perm)
│
├── payments/
│   ├── wallet.controller.ts           (absorb /payments/* routes)
│   └── payments.controller.ts         (deprecate, return 308 → /wallet/*)
│
├── daily-login/
│   └── daily-login.service.ts         (migrate to outbox pattern)
│
├── kyc/
│   ├── kyc-storage.ts                 (inject ConfigService)
│   ├── document-cipher.ts             (inject ConfigService)
│   ├── virus-scanner.ts               (inject ConfigService)
│   └── kyc.module.ts                  (inject ConfigService)
│
└── (all other folders unchanged)
```

**Zero files leave their feature folder.** Every extraction is internal to its module. Imports stay stable. Helm/Docker references unchanged. The recent Telegram merge is untouched.

---

## Part 4 · Refactor Plan (Step-by-step, Safe)

Each step is independently mergeable and revertible.

### Stage A · Foundation (no behavior change)

**A1.** Add `foundation/filters/all-exceptions.filter.ts` — produces `{ error: { code, message, details? }, requestId }`. Register in `main.ts`. Add spec.
**A2.** Decide on success envelope (see [Part 5 Question 1](#part-5--questions-before-i-write-code)).
**A3.** Add `foundation/decorators/deny-impersonated.decorator.ts` + `foundation/guards/impersonation-scope.guard.ts`. Register guard globally. Spec.

**Validation:** all existing tests pass; ad-hoc manual smoke (login, place bid, place aviator bet, view profile, hit admin endpoint).

### Stage B · Aviator extraction (P1-1)

**B1.** Create `aviator/aviator.gateway.ts`. Move Socket.IO setup + every `socket.emit()` and the broadcast helpers. `AviatorService` calls `gateway.emitXxx()`.
**B2.** Create `aviator/round-lifecycle.service.ts`. Move `startBettingPhase`/`startRunningPhase`/`tick`/`crashRound` + their state. Inject `BetSettlementService` for cap-triggered cashouts.
**B3.** Create `aviator/bet-settlement.service.ts`. Move `placeBet`/`cashout`/`cashoutInternal`. **Convert payout math to Decimal here** (P0-1).
**B4.** Create `aviator/aviator-analytics.service.ts`. Move stats/rollup/P&L/histogram methods.
**B5.** Trim `aviator.service.ts` to a thin composition root. All public method signatures unchanged — controllers don't move, callers don't see the split.
**B6.** Add specs per extracted service.

**Validation:** integration smoke — round runs end-to-end, bet places, cashout pays correct amount, fairness reveal works.

### Stage C · RBAC migration (P1-2)

**C1.** Add new permission slugs to `admin/permissions.ts`.
**C2.** Migrate `admin.controller.ts` mutations from `AdminGuard` to `@Perm('...')` annotations one method at a time.
**C3.** Same for `roles.controller.ts`, `settings.controller.ts`, `feature-flags.controller.ts`.
**C4.** Keep `AdminGuard` registered class-level as defense-in-depth.

**Validation:** admin SPA reaches every endpoint. Each new permission is granted to ADMIN role via `'*'` so no functional change.

### Stage D · Audit-log verification (P1-3)

**D1.** Locate or confirm absence of `audit-log.interceptor.ts`. Read its actual registration in module providers.
**D2.** If missing → add explicit `audit.record()` calls to admin.controller.ts mutations.
**D3.** If present → document in `foundation/README.md` and remove redundant explicit calls in SettingsController/FeatureFlagsController.

### Stage E · Razorpay consolidation (P2-1) **— requires client coordination**

**E1.** Add new endpoints under `/wallet/*` that accept optional `coinPackId`.
**E2.** Keep `/payments/*` as 308 redirects for one release.
**E3.** Update Android (`bet/`) + admin SPA (`admin/`) URL constants.
**E4.** Remove `/payments/*` after clients on new URLs (one release cycle).

**Skip this stage if you'd rather not coordinate with clients right now.**

### Stage F · Hygiene (P0-1 done in B3, plus the rest)

**F1.** Daily-login → outbox (P3-2).
**F2.** KYC `process.env` → `ConfigService` (P2-4).
**F3.** `public-aviator.controller.ts` prefix rename to `public/aviator` (P2-3).
**F4.** WS auth alignment (P2-2): add `passwordChangedAt` check on Bids connect.

### Stage G · Service-level tests (P3-1)

**G1.** `bids.service.spec.ts` — placeBid, wallet debit rollback, outbox path.
**G2.** `payments.service.spec.ts` — verify-and-credit idempotency, signature reject.
**G3.** `bet-wallet.service.spec.ts` — debit/credit/balance HTTP error handling.
**G4.** Auctions, daily-login.

---

## Part 5 · Questions Before I Write Code

I need three decisions from you before Stage A starts. Each blocks a meaningful piece of the refactor.

1. **Success response envelope.** Wrap all 200/201 responses as `{ data: ... }` (consistent shape, breaks clients) or only standardize **errors** and leave success raw (cheaper, no client breakage)?
2. **Razorpay consolidation (Stage E).** Skip — too much client coordination right now? Or proceed and update Android + admin SPA URLs in this branch?
3. **Stage ordering / scope.** Do all of A–G, or stop after Stage B (the aviator god-class split + cashout Decimal fix) which is the highest-value piece?

I'll wait for your call on these before any source edit.
