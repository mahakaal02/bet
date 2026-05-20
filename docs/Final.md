# Engineering Safety Guide

**The invariants — the rules that, when broken, break production.** Read before you touch anything; re-read before you merge.

This is the document that exists because we already know how the system can be broken, and we don't want to relearn it.

Companion to `summary.md` (what is here), `Documentation.md` (how to use it), `CONTEXT.md` (current state).

---

## How to use this doc

Every rule here has the same shape:

> **Rule.** What you must / must not do.
>
> **Why.** What breaks if you ignore it.
>
> **How to detect.** What test or code review catches a violation.

If you're reviewing a PR, scan the relevant section. If you're writing one, write the test that catches a violation **before** you write the code.

---

## Table of contents

- [Architectural invariants](#architectural-invariants)
- [Database + migrations](#database--migrations)
- [Cryptography + secrets](#cryptography--secrets)
- [Auth + sessions](#auth--sessions)
- [Outbox + concurrency](#outbox--concurrency)
- [Worker topology](#worker-topology)
- [Audit logging](#audit-logging)
- [Feature flags + settings](#feature-flags--settings)
- [Adapters + interfaces](#adapters--interfaces)
- [Helm + deployment](#helm--deployment)
- [Cascade conflict resolution](#cascade-conflict-resolution)
- [Required tests for common changes](#required-tests-for-common-changes)
- [Pre-merge checklist](#pre-merge-checklist)
- [Common breakage modes](#common-breakage-modes)

---

## Architectural invariants

### A1. Single image, two roles

**Rule.** One Docker image runs in both modes — `KALKI_ROLE=api` (HTTP + WS + crons) and `KALKI_ROLE=worker` (no HTTP, crons only). Don't fork the image; don't add role-conditional code outside `main.ts`.

**Why.** Diverging the images means double the deploy surface, double the build time, double the bug surface. The benefit of a worker pod is process isolation, not codebase isolation.

**How to detect.** Code-review check: a module conditionally registering different providers based on `KALKI_ROLE` is wrong. `main.ts` is the only legitimate consumer of the env var.

### A2. The HTTP path never blocks on external services

**Rule.** Bet wallet, FCM, SES, Razorpay, S3, KMS, ClamAV — none of these may be called synchronously from an HTTP handler. Always go through an outbox row or a worker drain.

**Why.** A 30-second SES outage would mean every signup hangs 30 seconds. A Razorpay 503 would mean coin-pack checkout fails despite the user already paying. The outbox lets the HTTP path return 200, the worker retries, the user never sees the failure.

**How to detect.** Grep for `await this.<external>.<call>(` inside any `@Post`/`@Patch`/`@Delete` handler. If you find one and it's not a query, it's wrong.

**Exception:** GET endpoints CAN fan out to external services for read-only enrichment. But they must fall back gracefully — see `BetWalletService.balance()` returning `null` (not `0`) when Bet is down, with `/auth/me` falling back to the local column.

### A3. The 27 product features are all behind feature flags

**Rule.** Anything new ships behind a row in the `FeatureFlag` table, default OFF. Existing endpoints that don't yet have one are excluded — don't retro-fit a flag onto a stable feature without coordination.

**Why.** Lets us deploy code and turn it on independently. Lets ops kill a rogue feature without a deploy. Lets a/b ramp.

**How to detect.** Code review: new module has no `FeatureFlag` consumer? Reject. Default `enabled: true` in the seed? Reject.

### A4. Zero new npm deps for external protocols

**Rule.** AWS SigV4, OTP, RSA verify, INSTREAM — implement against Node's built-in `crypto` + `fetch`. Don't add `@aws-sdk/*`, `otplib`, `aws-sns-validator`, `clamscan`.

**Why.** Each SDK is 5–15 MB transitively, brings a supply-chain attack surface (Tink, request-deprecated, sax), and we've shown the protocol code is ~50–100 lines. See `aws/sigv4.ts`, `auth/totp.ts`, `kyc/virus-scanner.ts`, `notifications/sns-signature-verifier.ts`.

**Exception:** When the protocol is non-trivial AND the lib is actively maintained AND we'd use most of its surface — e.g. `bcrypt`, `class-validator`, `@nestjs/jwt`. Document the call in the PR description.

**How to detect.** Code review: new dep in `package.json`? Either reuse an existing primitive or justify the addition in the PR description.

---

## Database + migrations

### D1. Migrations are forward-only

**Rule.** Prisma doesn't generate down migrations and we never write them. Plan your migrations to be additive. If you need to remove a column, do it in two steps: deploy a release that doesn't read it, then a later release that drops it.

**Why.** Reverting a deploy that already migrated would corrupt the DB. Down migrations are a footgun in any non-trivial system.

**How to detect.** Code review: a `DROP COLUMN` or `DROP TABLE` in a migration that's coupled to code still depending on it. Reject — split into two PRs.

### D2. Every seed migration uses `ON CONFLICT DO NOTHING` (or upsert)

**Rule.** Seed migrations run on every pod boot via the init container. They MUST be idempotent.

**Why.** Without `ON CONFLICT`, the second pod boot fails with a unique-key violation, which blocks the rest of the migration chain.

**How to detect.** Grep your migration SQL for `INSERT INTO` without `ON CONFLICT DO NOTHING` or `ON CONFLICT … DO UPDATE`. Reject.

### D3. Schema changes go through `prisma migrate dev`

**Rule.** Never hand-write a migration SQL file. Edit `schema.prisma`, run `npx prisma migrate dev --name <slug>`, commit the generated directory.

**Why.** Hand-written migrations drift from `schema.prisma`. The `_prisma_migrations` table tracks the directory hash; mismatches fail at boot.

**How to detect.** Code review: a migration SQL that's not paired with a `schema.prisma` diff. Reject.

### D4. Don't reference a model from outside its module's service

**Rule.** Only the owning module's service should access a Prisma model directly. Other modules talk to it via the owning service.

**Why.** Lets us refactor the storage layer of a module (denormalisation, splitting a table) without touching every caller. Same reason as the adapter pattern.

**How to detect.** Grep for `this.prisma.<model>.` outside the owning module. Reject — extract a service method.

**Exception:** `User`, `AdminAuditLog`, and `Outbox` are cross-module; direct access is fine.

---

## Cryptography + secrets

### C1. Encrypt every sensitive blob with a versioned envelope

**Rule.** Any field that holds PII, credentials, or anything beyond a display string is AES-256-GCM encrypted via `SecretCipher` (local-key) or `DocumentCipher` (KMS). The ciphertext is prefixed with a 1-byte version.

**Why.** Key rotation. The version byte tells the decoder which key + algorithm to use, so rotating doesn't require a backfill.

**Version byte ranges:**
- `1–99`: `LocalKeyDocumentCipher` / `SecretCipher` rotations.
- `100–199`: `KmsDocumentCipher` envelope formats (current: 100).

**How to detect.** Code review: a `string` column holding a TOTP secret, OTP code, KYC document, refresh token, etc. that's not run through one of these helpers. Reject.

### C2. AWS calls go through the shared SigV4 signer

**Rule.** `backend/src/aws/sigv4.ts` signs every AWS request. Don't duplicate signing logic.

**Why.** SigV4 has a half-dozen subtle edge cases (RFC 3986 vs `encodeURIComponent`, header sort order, body hash placement, `x-amz-security-token` when using STS). Get one wrong, AWS returns `SignatureDoesNotMatch`. Centralising the logic + spec-testing it once is the only safe path.

**How to detect.** Grep for `createHmac` or `createHash('sha256')` outside `aws/sigv4.ts` paired with an AWS endpoint. Reject — call the shared signer.

### C3. Don't log secrets

**Rule.** Never `logger.log(token)` / `logger.log(jwt)` / `logger.log(password)` / `logger.log(privateKey)`.

**Why.** Kubernetes logs land in CloudWatch / Loki / wherever. Once a secret hits a log line, you can't unship it from the index.

**How to detect.** Grep for `\.log(.*token` / `\.log(.*password` / `\.log(.*secret`. Reject.

### C4. The Postgres password in `values.yaml` is a known-issue sentinel

**Rule.** The literal `kalki-postgres-default` in `helm/kalki/values.yaml` matches the value baked into the cluster's StatefulSet PV. Don't change it without running the rotation runbook (commented inline in `values.yaml`).

**Why.** Postgres ignores env-var changes after first-boot. The PV stores the password hash. Changing `values.yaml` without rotating in-cluster breaks every client.

---

## Auth + sessions

### S1. JWT extraction is Bearer-first, cookie-fallback

**Rule.** `JwtStrategy` extracts the JWT via `ExtractJwt.fromExtractors([Bearer, cookie])`. Bearer always wins when both are present.

**Why.** A misconfigured admin browser that sends both shouldn't accidentally authenticate as the cookie subject. Explicit beats ambient.

**How to detect.** Code review of `auth/jwt.strategy.ts` — the extractor order must be Bearer first. Reject any reorder.

### S2. Admin endpoints set cookies via `serializeAdminCookie`

**Rule.** Don't use `res.cookie()`. Use `serializeAdminCookie()` from `auth/cookie.ts`.

**Why.** We need consistent flags (`HttpOnly`, `SameSite=Lax`, env-driven `Secure`, configurable `Domain`). `res.cookie()` has surprising platform-adapter behaviour in test contexts.

**How to detect.** Grep for `res.cookie` in `auth/` — reject; should be `serializeAdminCookie`.

### S3. Admin login asserts `isAdmin === true` server-side

**Rule.** Any endpoint that sets the admin cookie MUST check `user.isAdmin` and return 403 otherwise. Don't rely on client-side display checks.

**Why.** A non-admin landing in the admin SPA with a cookie set would have a usable session for any admin API the SPA happens to hit.

**How to detect.** Test: feed `auth.login` returning `{ user: { isAdmin: false } }` to the admin endpoint; assert it throws `ForbiddenException`. This is covered in `auth.controller.admin.spec.ts`.

### S4. Cross-app SSO uses short-lived tokens

**Rule.** The admin → Bet handoff fetches a 60-second JWT via `/auth/admin/sso-token` and tucks it in the URL. Don't pass the 12h session JWT in any URL.

**Why.** URLs land in browser history, referrer headers, server access logs. A 60s token has zero blast radius; a 12h token is a session.

**How to detect.** Grep for `?token=<long-jwt>` patterns; reject in favour of the sso-token / sso-accept handoff.

### S5. Password resets invalidate every existing session

**Rule.** `User.passwordChangedAt` is set on password reset; `JwtStrategy.validate()` rejects tokens with `iat < passwordChangedAt`. Don't bypass that check.

**Why.** Without it, a leaked JWT survives the user's response to the leak.

**How to detect.** Existing tests in `password-reset.service.spec.ts` cover this. Don't reduce the check to "convenient cases only".

---

## Outbox + concurrency

### O1. Every outbox dispatcher is idempotent

**Rule.** A dispatcher MUST be safe to call twice. The outbox marks a row `SENT` after success; on crash mid-call, the worker re-tries. The dispatcher's downstream must dedupe by the payload's stable key.

**Why.** Distributed systems guarantee at-least-once. Your dispatcher must be once-effectively, not once-exactly.

**How to detect.** Test: call the dispatcher twice with the same payload; assert the downstream sees the effect once or as a stable upsert. Add to the dispatcher's spec.

### O2. `SELECT … FOR UPDATE SKIP LOCKED` is the only safe drain pattern

**Rule.** The outbox / notification / fraud / recon drains use `SKIP LOCKED`. Don't write a drain loop without it.

**Why.** Two workers running the same `SELECT … LIMIT 50 FOR UPDATE` (without SKIP LOCKED) will block each other. Two without `FOR UPDATE` will both pick the same rows. SKIP LOCKED is the only formulation that scales horizontally.

**How to detect.** Grep for `FOR UPDATE` in raw SQL — must be followed by `SKIP LOCKED`. Reject otherwise.

### O3. The outbox transaction wraps the producer's row update

**Rule.** Write the outbox row in the same `prisma.$transaction` as the state mutation that triggered it. Don't write the state, then commit, then write the outbox.

**Why.** Crash between the two writes loses the side effect (state advances; outbox never enqueues). Same-tx makes them atomic.

**How to detect.** Grep for `INSERT INTO "Outbox"` patterns outside a `$transaction` block. Suspect; check.

---

## Worker topology

### W1. Worker pod is `replicas: 1` until leader election

**Rule.** `helm/kalki/values.yaml::backend.worker.replicas` stays at `1` until `PR-LEADER-ELECT` lands.

**Why.** SKIP LOCKED prevents data corruption (two workers see different rows). But `@Cron('0 2 * * *')` fires on EVERY pod's clock — two pods would run nightly recon twice. Most jobs are idempotent at the data level, but the side effects (emails, audit log entries) double up.

**How to detect.** Code review of `values.yaml`: `worker.replicas: > 1`? Reject (or require a paired leader-election PR).

### W2. `KALKI_ROLE` is read only in `main.ts`

**Rule.** No module factory reads `KALKI_ROLE` directly. The bootstrap path is the single dispatcher.

**Why.** Diverging boot logic = diverging behavioural surface. Stays small if there's exactly one place to branch.

**How to detect.** Grep for `KALKI_ROLE` outside `main.ts`. Reject.

### W3. SIGTERM drains cleanly

**Rule.** The worker bootstrap (`main.ts::bootstrapWorker`) handles SIGTERM by calling `app.close()` then `process.exit(0)`. Don't add a handler that exits before the drain.

**Why.** Kubernetes `terminationGracePeriodSeconds` (default 30s) is the budget for in-flight outbox rows to complete. Hard-killing mid-drain means re-processing on the next pod, which (per O1) is fine — but degrades dashboards.

**How to detect.** Watch the worker's logs on a `kubectl delete pod`. The expected sequence is `received SIGTERM → worker shutdown OK → exit 0`.

---

## Audit logging

### AU1. Every state-changing admin endpoint writes an audit row

**Rule.** Admin-RBAC-guarded endpoints that mutate data MUST call `auditLogService.record({ action, targetType, targetId, before, after })`.

**Why.** Compliance, forensics, customer support all need a paper trail. The doc retention is 7 years; we don't get to skip this on convenience.

**How to detect.** Code review: an `@Post` / `@Patch` / `@Delete` on an admin controller without a paired `audit.record()` call. Reject.

### AU2. Snapshot `before` BEFORE the `prisma.update`

**Rule.** The `before` payload must be captured into a local variable before the update runs. Don't pass `user.before` after `prisma.update` mutated `user`.

**Why.** Prisma's mock layer (and certain real configurations) mutate the same row object in place. The audit log will read "before === after" if you pass the live reference.

**How to detect.** Code review: an `audit.record({ before: <something>, after: <something> })` where `<something>` was assigned after the update. Reject.

This bug bit us 5 times during the program. Every time the spec caught it — keep writing the spec.

### AU3. PII reads on the KYC surface are audited too

**Rule.** Every decrypted document preview, every full-row admin query on `KycDocument` writes an audit row (action `KYC_DOCUMENT_VIEWED`). Not just mutations.

**Why.** PII access is a regulated act. We need to be able to answer "who saw this user's passport last quarter".

**How to detect.** Code review of any new admin endpoint that touches `KycDocument` / `KycVerification`. Must have an audit call.

---

## Feature flags + settings

### FF1. New behaviour defaults OFF

**Rule.** Every new feature flag is seeded with `enabled = false`. Operator flips on after the deploy. Same for `SystemSetting` thresholds — the seed value is the conservative safe default.

**Why.** Deploy and turn-on are different events; coupling them means every regression is a deploy rollback.

**How to detect.** Code review of the seed migration: `enabled: true` on a new flag? Reject.

### FF2. Flags are read via `FeatureFlagService.isEnabled()`, not from env

**Rule.** Don't read `process.env.NOTIFICATIONS_ENABLED`. Read `await this.featureFlag.isEnabled('notifications.enabled')`.

**Why.** Flipping a flag without a redeploy is the whole point. Env vars require restart.

**How to detect.** Grep for `process.env.<UPPER_SNAKE>` for things that look feature-flag-shaped. Reject.

### FF3. Settings catalog rows are the only operator dials

**Rule.** Anything an operator might want to tune (SLA minutes, fraud thresholds, payout caps) lives in `SystemSetting` with a typed `value` column. Hard-coded literals are forbidden for anything ops would tune in prod.

**Why.** "Edit the source + deploy" is the wrong tool for changing the URGENT-priority ticket SLA from 60 minutes to 30.

**How to detect.** Code review: a numeric literal that's not a constant (e.g. `<= 60_000`)? Look at whether ops should tune it. If yes — wire to `SystemSetting`.

---

## Adapters + interfaces

### AD1. Production adapters loud-fail on missing config

**Rule.** `S3KycStorage`, `KmsDocumentCipher`, `ClamAvVirusScanner` MUST throw immediately if their required env vars (creds, host) are missing. Don't silently no-op.

**Why.** A silently no-op virus scanner means infected documents pass. A silently no-op cipher means cleartext lands in S3. Loud failure surfaces misconfigured deploys at boot, before any user sees the damage.

**How to detect.** Test: construct the adapter with empty creds → assert it throws. Covered in `kyc-storage.spec.ts`, `document-cipher.spec.ts`, `virus-scanner.spec.ts`.

### AD2. Adapters inject their dependency

**Rule.** `S3KycStorage(fetchImpl?)`, `KmsDocumentCipher(fetchImpl?)`, `ClamAvVirusScanner(connectFn?)` — the dependency is a constructor argument so tests pass a fake.

**Why.** Without this, tests need global `fetch` / `net.connect` mocking. Constructor injection is local + composable + clear.

**How to detect.** Code review: a new adapter that grabs `globalThis.fetch` directly inside a method body. Reject.

### AD3. The factory selects the impl based on env

**Rule.** `<module>.module.ts` has a `Provider` with a `useFactory` that reads the env var and returns the right impl.

**Why.** Centralises the swap. Tests can override the provider via `Test.createTestingModule().overrideProvider()`.

**How to detect.** Code review: a `new S3KycStorage()` in a service constructor instead of `@Inject(KYC_STORAGE)`. Reject.

---

## Helm + deployment

### H1. New infra defaults OFF in `values.yaml`

**Rule.** A new Helm-deployed component (ClamAV daemon, worker pod, etc.) ships with `<component>.enabled: false`. Operator opts in.

**Why.** Same reason as feature flags. Dev clusters / fresh installs should boot without it.

**How to detect.** Code review: `enabled: true` on a new component? Reject.

### H2. Env vars are wired conditionally

**Rule.** Helm `backend.yaml` env list wraps new env vars with `{{- if .Values.<feature>.enabled }} … {{- end }}`. Don't unconditionally add a `KYC_KMS_KEY_ID` env that pollutes every dev pod.

**Why.** Pods don't need to know about adapters they don't use. Less noise in `kubectl describe pod`.

**How to detect.** Code review of `backend.yaml` env list: env vars without a guard. Reject.

### H3. Recreate strategy for stateful PVCs

**Rule.** Deployments using a `ReadWriteOnce` PVC use `strategy: { type: Recreate }`. Not RollingUpdate.

**Why.** RWO + RollingUpdate → new pod can't mount the volume → old pod can't terminate → deadlock.

**How to detect.** Code review: `strategy: { type: RollingUpdate }` paired with a RWO PVC mount. Reject.

### H4. Probes survive the slow-boot case

**Rule.** ClamAV takes ~60-90s to load the signature DB. Probe `initialDelaySeconds` MUST cover that. `livenessProbe.failureThreshold` MUST be > 1 so a transient connection refused doesn't CrashLoopBackoff a healthy daemon.

**Why.** Generic 30s `initialDelaySeconds` works for Node services. ClamAV needs more.

**How to detect.** Code review of any new daemon Deployment: probe values are not generic defaults. Reject if the author hasn't justified them.

---

## Cascade conflict resolution

### CC1. The "Take BOTH" pattern

**Rule.** When two PRs both add a module to `app.module.ts` `imports:` list, the merge conflict resolution is to keep BOTH lines.

**Why.** This is the most common conflict during the program. The PRs touch the same file but the changes are additive. Choosing "ours" or "theirs" deletes a module's wiring.

**How to detect.** A merge conflict that looks like:
```
<<<<<<< HEAD
  TicketsModule,
=======
  ReconciliationModule,
>>>>>>> branch
```
Resolve to:
```
  TicketsModule,
  ReconciliationModule,
```

### CC2. Re-run tests after every cascade resolve

**Rule.** After resolving a cascade conflict, run `npx jest` before committing. A correctly-resolved conflict still compiles; the question is whether the resolved code is semantically correct.

**Why.** A "Take BOTH" can break if both branches expected to be alone with a global (e.g. a default `BACKEND_JWT_SECRET` literal that needs to be one value, not two).

**How to detect.** Failing tests after the resolve. Trust the suite.

### CC3. Stacked PRs auto-rebase

**Rule.** When `#X` is stacked on `#Y` (e.g. CSV-2 on CSV-1), merging `#Y` first auto-rebases `#X` onto `main`. Don't manually rebase a stacked PR before its base merges.

**Why.** Manual rebase before the base merge creates a divergent history; GitHub gets confused; the green merge button goes red.

---

## Required tests for common changes

| If you change… | Add a test for… |
|---|---|
| A new outbox kind | Dispatcher called once on a single row; backoff respected on failure. |
| A new feature flag consumer | Behaviour with flag OFF (no-op) AND flag ON (active). |
| A new admin endpoint | Permission gate rejects without slug; happy path with slug; audit row written. |
| A new Prisma model | At least one service spec that creates + reads it. |
| A new external API call | A test with `fetchImpl` mock asserting the request shape (URL, headers, body). |
| A new SQL using `FOR UPDATE` | Two concurrent calls don't deadlock + don't both pick the same row. |
| A new state machine transition | Every legal transition + every illegal transition rejected. |
| A new image-processing path | EXIF strip is verified + the output is the expected MIME. |
| A new admin SPA page | At least a render-without-error smoke (the existing tests have one of these). |
| A new mobile-facing endpoint | Bearer path works (cookie path is admin-only). |

---

## Pre-merge checklist

Print this. Tape it next to your monitor.

- [ ] `npx tsc --noEmit` clean on backend + admin (+ auctions + aviator if you touched them).
- [ ] `npx jest` passes on backend (640/640 as of Q2).
- [ ] `npx nest build` clean.
- [ ] If you added an env var: documented in `Documentation.md` + wired in Helm `values.yaml`.
- [ ] If you added a Prisma model / field: migration committed alongside the schema change.
- [ ] If you added a seed insert: `ON CONFLICT DO NOTHING` (or upsert).
- [ ] If you added a feature flag: seeded with `enabled = false`.
- [ ] If you added an admin endpoint: `@RequirePermission('<slug>')` decorator + permission seeded.
- [ ] If you added a state mutation: audit log row with snapshot-before-update.
- [ ] If you added an external API call: `fetchImpl` / `connectFn` injection so tests don't hit the network.
- [ ] If you added a Helm component: `enabled: false` default + conditional env wiring.
- [ ] If you added a new doc: linked from `CONTEXT.md`.
- [ ] PR body has a "Test plan" checklist for the reviewer.
- [ ] Commit message explains *why*, not just *what*.

---

## Common breakage modes

The post-mortem index. Each entry is a real breakage shape we hit during the program (or that we instrumented against because the audit found the risk).

### B1. `prisma.update` mutated the row reference, audit log captured post-update state

**Symptom.** Audit log `before` and `after` are identical. Spec assertion fails on `toHaveBeenCalledWith({ before: { …pre… }, … })`.

**Fix.** Snapshot before update. See [AU2](#au2-snapshot-before-before-the-prismaupdate).

### B2. Two workers double-processed an outbox row

**Symptom.** Same payload SENT twice. Downstream sees the side effect twice (email, push, debit).

**Fix.** The dispatcher's downstream must dedupe by the payload's stable key. See [O1](#o1-every-outbox-dispatcher-is-idempotent).

### B3. KMS Decrypt failed with `InvalidCiphertextException`

**Symptom.** Existing rows can't decrypt after a deploy.

**Likely cause.** The cipher's version byte was bumped without backwards-compat for old rows. See `KMS_ENVELOPE_V1 = 100` — never reuse a version byte; never drop the version-mismatch check.

**Fix.** Add the old version byte back as a parallel decode path.

### B4. CORS preflight fails for the admin SPA

**Symptom.** Browser console: `Access-Control-Allow-Origin: '*' is incompatible with credentials`.

**Likely cause.** `CORS_ALLOWED_ORIGINS` is unset, so `app.enableCors()` defaults to `*`, which the browser refuses with `credentials: true`.

**Fix.** Set `CORS_ALLOWED_ORIGINS=https://kalki-admin.cloud.podstack.ai` in the `kalki-shared` Secret.

### B5. Postgres unique-key violation on second pod boot

**Symptom.** Init container's `prisma db seed` step fails on second startup with `P2002`.

**Fix.** The new INSERT in your seed migration is missing `ON CONFLICT DO NOTHING`. See [D2](#d2-every-seed-migration-uses-on-conflict-do-nothing-or-upsert).

### B6. `Cleartext HTTP traffic not permitted` on Android release builds

**Symptom.** Login screen freezes; OkHttp logs show the error.

**Likely cause.** A new endpoint URL got introduced with `http://` instead of `https://`. Release builds use `app/src/main/res/xml/network_security_config.xml` which blocks cleartext entirely.

**Fix.** Use HTTPS. If you need cleartext for emulator-only testing, the debug config at `app/src/debug/res/xml/network_security_config.xml` already allows `10.0.2.2` / `localhost` / `127.0.0.1`.

### B7. The `_prisma_migrations` table has a stuck row

**Symptom.** Pod restart loops on `prisma migrate deploy`; logs show "migration X is in-flight".

**Fix.** The init container at `backend.yaml` already self-heals — it `DELETE`s rows with `finished_at IS NULL AND rolled_back_at IS NULL AND started_at < NOW() - INTERVAL '5 minutes'`. If you see this in the wild, the cleanup window may need widening.

### B8. The session token survived a password reset

**Symptom.** User resets password but the old JWT still works.

**Likely cause.** Something is bypassing the `passwordChangedAt` check in `JwtStrategy.validate()`. See [S5](#s5-password-resets-invalidate-every-existing-session).

### B9. SES bounce webhook silently dropped real bounces

**Symptom.** Bounce list doesn't grow despite real bounce events arriving at SNS.

**Likely cause.** `NOTIFY_WEBHOOK_TOPIC_ARN` mismatches the actual SNS topic ARN, so the controller returns `topic_mismatch` early.

**Fix.** Check the env var matches the SNS topic ARN. The mismatch is logged at `warn` level — search the backend logs.

### B10. Admin SPA logs out spontaneously after deploy

**Symptom.** Users on the admin SPA see a forced re-login after a backend deploy.

**Likely cause.** `JWT_SECRET` was rotated (deliberate or accidental). All existing JWTs invalidate.

**Fix.** Coordinate JWT_SECRET rotation. The cookie session JWT TTL is 12h by default, so a rotation invalidates every active session.

---

## Final word

If something here is wrong, **fix it in the same PR as the code change that revealed the wrongness**. Docs drift fast; the only way to keep them honest is to fix them as you go.

If you find a new breakage mode that isn't in `Common breakage modes`, add it. Future-you will thank present-you.

If you disagree with a rule here: write the PR that changes it. The rules exist because they were the right answer at the time; they're not immutable, just hard-won.
