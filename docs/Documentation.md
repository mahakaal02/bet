# Developer Documentation

**How to use the platform + what every developer needs to know before touching code.**

Companion to `summary.md` (what is here, structurally) and `Final.md` (how not to break it). Read those before this one if you've never seen the codebase.

---

## Table of contents

- [Local setup](#local-setup)
- [The 5-minute mental model](#the-5-minute-mental-model)
- [Repository layout](#repository-layout)
- [Running things](#running-things)
- [Common workflows](#common-workflows)
- [Conventions](#conventions)
- [Where to look for what](#where-to-look-for-what)
- [Testing](#testing)
- [Environment variables (the full list)](#environment-variables)
- [Pitfalls — read before you cause them](#pitfalls)

---

## Local setup

### One-time

```bash
# Postgres 16
brew install postgresql@16
brew services start postgresql@16

# Redis 7 (used for rate-limit + future leader election)
brew install redis
brew services start redis

# Node 20 LTS — Nest builds, Vite builds, ts-node seeds all assume this.
nvm install 20
nvm use 20

# Create the two DBs the backend + Bet services need
psql postgres -c "CREATE DATABASE uniquebid;"
psql postgres -c "CREATE DATABASE bet;"
```

### Per-project install

```bash
# Backend (Nest + Prisma)
cd backend && npm install && npx prisma generate && npx prisma migrate deploy && npx ts-node prisma/seed.ts

# Auctions (Next.js user-facing surface)
cd ../auctions && npm install

# Admin SPA (Vite + React)
cd ../admin && npm install

# Aviator (Next.js + canvas game)
cd ../aviator && npm install

# Bet exchange service
cd ../bet && npm install && npx prisma generate && npx prisma migrate deploy

# Android (if you're touching the mobile shell)
# Open in Android Studio; Gradle 8.7 + AGP 8.7.3 + JDK 17 are auto-resolved.
```

### Daily

```bash
# In four separate terminals:
cd backend  && npm run start:dev    # :4000  — backend API + WebSocket
cd auctions && npm run dev          # :3200  — user-facing auctions SPA
cd admin    && npm run dev          # :5173  — admin SPA (Vite)
cd bet      && npm run start:dev    # :3100  — Bet wallet service
# Aviator + Android are optional unless you're touching them.
```

`npm run start:dev` on the backend watches the source tree. Save a file → restart in under 2s. Type errors print to stdout and are non-fatal (the worker keeps running on the last good build until you fix the type).

---

## The 5-minute mental model

If you only remember three things from this doc, make them these:

1. **The backend is the source of truth, but never blocks on external services for user-facing work.** Every cross-service side effect (wallet debit, email, push, KYC scan) goes through the **outbox pattern**. The HTTP handler writes a row; a worker drains it. Outage of Bet/SES/FCM never breaks user-facing endpoints.

2. **Adapters + env vars** swap real backends in and out. KYC document storage in dev = disk file; in prod = S3+KMS. Same code path; only env vars differ (`KYC_STORAGE_DRIVER`, `KYC_VIRUS_SCANNER`, `KYC_CIPHER_DRIVER`). Same for storage (avatars / auctions), notifications, Bet wallet client. **Tests inject a fake at the adapter seam; production sees real AWS.**

3. **Feature flags default OFF.** Every new behaviour ships behind a `FeatureFlag` row in the DB (cached 10s in-memory). New endpoints land but stay inert. Operators flip via the admin SPA `/feature-flags` or via SQL. Lets us deploy code and turn it on independently.

---

## Repository layout

```
.
├── backend/                # NestJS + Prisma + Postgres (THIS IS YOUR HOME)
│   ├── src/                #   30 modules — see summary.md service map
│   ├── prisma/             #   Schema + migrations + seed
│   └── test/               #   Jest specs live next to source as `*.spec.ts`
├── auctions/               # Next.js — user-facing auctions hub
├── admin/                  # Vite + React SPA — admin console
├── aviator/                # Next.js — Aviator crash-multiplier game
├── bet/                    # NestJS — Bet exchange + wallet service
├── app/                    # Android app (Kotlin + Compose)
├── helm/kalki/             # Helm chart for the whole stack
├── docs/                   # ← you are here
└── .github/workflows/      # CI (lint, test, build, image push)
```

Inside each backend module:

```
backend/src/<module>/
├── <module>.module.ts        # NestJS DI wiring
├── <module>.service.ts       # The business logic
├── <module>.controller.ts    # Public REST surface (if any)
├── <module>-admin.controller.ts  # Admin RBAC-guarded surface (if any)
├── dto/                      # class-validator request/response DTOs
└── <something>.spec.ts       # Tests live next to the unit they test
```

**Where to add a new feature**: typically `backend/src/<new-module>/` (mirroring the existing modules) + a Prisma migration + a Helm env-var line if it needs config. See [Common workflows](#common-workflows).

---

## Running things

### Backend

```bash
cd backend
npm run start:dev               # watch mode (default for dev)
npm run start:prod              # production-shaped (after `nest build`)
npm test                        # all 640 Jest tests
npx jest src/kyc/               # one module's tests
npx tsc --noEmit                # type-check only
npx nest build                  # production build → dist/
npm run prisma:migrate          # apply pending migrations to local DB
npx prisma migrate dev --name <slug>   # create a new migration
npx ts-node prisma/seed.ts      # re-run the idempotent seed
```

### Admin SPA

```bash
cd admin
npm run dev                     # Vite dev server on :5173
npx vite build                  # production bundle → dist/
npx tsc --noEmit                # type-check
```

### Worker mode (testing the dedicated worker pod locally)

```bash
cd backend
KALKI_ROLE=worker npm run start:dev
# No HTTP listener; @Cron jobs fire; SIGTERM drains cleanly.
```

### Tests

```bash
# Run the entire backend suite (~17s, 640 tests as of Q2)
cd backend && npx jest

# Run a single file
npx jest src/kyc/virus-scanner.spec.ts

# Run a single describe
npx jest -t "ClamAvVirusScanner.parseReply"

# Watch mode
npx jest --watch
```

CI runs `npx tsc --noEmit && npx jest && npx nest build` on every push to `claude/*` branches.

---

## Common workflows

### Add a new API endpoint

1. Create the module if it doesn't exist:
   ```bash
   mkdir backend/src/widgets
   touch backend/src/widgets/{widgets.module.ts,widgets.service.ts,widgets.controller.ts}
   mkdir backend/src/widgets/dto && touch backend/src/widgets/dto/create-widget.dto.ts
   ```
2. Wire the module in `backend/src/app.module.ts` (add to the `imports` array).
3. Write the controller (`@UseGuards(JwtAuthGuard)` for user-authed; `@RequirePermission('widgets.create')` for admin).
4. Add a class-validator DTO. Backend's global `ValidationPipe` (in `main.ts`) auto-validates.
5. Write the service. Inject `PrismaService` for DB access.
6. Add a `*.spec.ts` covering the controller + service. Jest is already configured.

Follow the pattern of any existing module — `daily-login/`, `addresses/`, `tickets/` are small and self-contained.

### Add a new Prisma migration

```bash
cd backend
# 1. Edit prisma/schema.prisma — add your model or field.
# 2. Generate the migration:
npx prisma migrate dev --name <slug-describing-change>
# This creates backend/prisma/migrations/<TIMESTAMP>_<slug>/migration.sql
# AND applies it to your local DB. Commit the migration directory.

# In prod: the backend init container runs `prisma migrate deploy` on every pod boot.
# Down migrations: Prisma doesn't generate them. Plan your forward migration to be additive.
```

### Add a new feature flag

```bash
# 1. Add a row to a seed migration (or write a new one):
cd backend
cat <<EOF > prisma/migrations/$(date +%Y%m%d%H%M%S)_my_flag_seed/migration.sql
INSERT INTO "FeatureFlag" (id, "enabled", "description", "createdAt", "updatedAt")
VALUES ('my.feature', false, 'Toggles the new widget UI', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
EOF

# 2. In your service:
const enabled = await this.featureFlag.isEnabled('my.feature');
if (!enabled) return { feature: 'disabled' };

# 3. Flip in prod via the admin SPA → /feature-flags → toggle.
# Cache TTL is 10s, so flips propagate fast.
```

### Add a new admin RBAC permission

```bash
# 1. Add the slug to backend/src/admin/permissions.ts:
export const PERMISSIONS = {
  …existing,
  WIDGETS_CREATE: 'widgets.create',
};

# 2. Seed via a Prisma migration:
INSERT INTO "Permission" (slug, description) VALUES ('widgets.create', 'Create widgets')
ON CONFLICT (slug) DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionSlug")
SELECT id, 'widgets.create' FROM "Role" WHERE name IN ('ADMIN', 'MODERATOR')
ON CONFLICT DO NOTHING;

# 3. Decorate the admin controller:
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermission('widgets.create')
@Post()
create() { … }
```

### Add a new notification type

```bash
# 1. Add a template row via a seed migration:
INSERT INTO "NotificationTemplate" (key, "title", "body", channels)
VALUES (
  'widget_assigned_v1',
  'A widget was assigned to you',
  'Hi {{username}}, you got widget {{widgetName}}.',
  ARRAY['INAPP', 'EMAIL']::"NotificationChannel"[]
);

# 2. Enqueue from your service:
await this.notification.enqueue({
  userId: 'user-id',
  templateKey: 'widget_assigned_v1',
  payload: { username: 'foo', widgetName: 'bar' },
  channels: ['INAPP', 'EMAIL'],
});

# 3. NotificationWorker drains PENDING rows every 1.5s — your enqueue
#    is fire-and-forget from the producer's POV.
```

### Add a new outbox kind (cross-service side effect)

```bash
# 1. Add to enum OutboxKind in schema.prisma + migrate.
# 2. Register a dispatcher in the appropriate module's onModuleInit:
this.outboxService.registerDispatcher('WIDGET_SHIPPED', async (payload) => {
  await this.shippingApi.notify(payload);
});
# 3. Producer side: INSERT INTO "Outbox" with status=PENDING, kind='WIDGET_SHIPPED'.
# The worker pod drains it; backoff + retry are automatic.
```

### Wire a new env var into Helm

```bash
# 1. Add a section to helm/kalki/values.yaml with the default:
mywidget:
  enabled: false
  endpoint: "https://api.widget.io"

# 2. Reference in helm/kalki/templates/backend.yaml env list:
{{- if .Values.mywidget.enabled }}
- name: MYWIDGET_ENDPOINT
  value: {{ .Values.mywidget.endpoint | quote }}
{{- end }}

# 3. Read in your service:
this.endpoint = process.env.MYWIDGET_ENDPOINT ?? '<sensible-default>';

# Production rollout: operator sets `mywidget.enabled=true` in their values
# overlay + `kubectl rollout restart` on the backend.
```

### Run a one-off SQL on the prod DB

```bash
kubectl -n kalki exec -it $(kubectl -n kalki get pods -l app.kubernetes.io/name=backend -o jsonpath='{.items[0].metadata.name}') -- \
  npx prisma db execute --stdin --schema=prisma/schema.prisma <<< \
  "UPDATE \"FeatureFlag\" SET enabled = true WHERE id = 'my.feature';"
```

---

## Conventions

### Naming

| Thing | Convention | Example |
|---|---|---|
| Module directory | kebab-case singular | `kyc/`, `daily-login/` |
| Controller method | verb + noun (REST verb implied) | `list()`, `create()`, `approve()` |
| Service method | full verb phrase | `submitDocument()`, `approveTicket()` |
| DTO | `<Verb><Noun>Dto` | `CreateAuctionDto`, `UpdateProfileDto` |
| Test file | next to the unit, `<unit>.spec.ts` | `kyc.service.spec.ts` |
| Migration directory | `<YYYYMMDDHHMMSS>_<snake_case_slug>` | `20260520140000_kyc_documents` |
| Outbox kind | SCREAMING_SNAKE | `BET_WALLET_DEBIT`, `REFERRAL_PAYOUT` |
| Feature flag id | `<domain>.<feature>` dot-namespaced | `notifications.enabled`, `kyc.enabled` |
| Permission slug | `<domain>.<action>` dot-namespaced | `audit.read`, `withdrawal.approve` |
| Error code (in HTTP responses) | SCREAMING_SNAKE | `KYC_DOCUMENT_NOT_FOUND`, `INVALID_PROMO_CODE` |

### Errors

Throw NestJS HTTP exceptions with a `code` field:

```typescript
throw new BadRequestException({ code: 'KYC_INFECTED_DOCUMENT' });
throw new NotFoundException({ code: 'TICKET_NOT_FOUND' });
throw new ForbiddenException({ code: 'ADMIN_ACCESS_REQUIRED' });
```

The frontend reads the `code` (stable enum) for branching logic; the `message` is human-readable for fallback display. **Always use the `code` field** so client code never has to string-match on prose.

### Validation

DTOs use `class-validator`. The global `ValidationPipe` in `main.ts` runs `{ whitelist: true, transform: true, forbidNonWhitelisted: true }` — unknown fields are rejected with 400.

```typescript
class CreateWidgetDto {
  @IsString() @MinLength(1) @MaxLength(100)
  name!: string;
  @IsOptional() @IsBoolean()
  active?: boolean;
}
```

### Audit logging

State-changing admin actions write to `AdminAuditLog`:

```typescript
await this.audit.record({
  actorId: admin.id,
  action: 'TICKET_ASSIGNED',
  targetType: 'Ticket',
  targetId: ticket.id,
  before: previousAssigneeSnapshot,
  after: { assignedToId: newAssignee.id },
});
```

The `before` payload MUST be snapshotted before the `prisma.update` runs. See [Pattern 3 in `summary.md`](#pattern-3--snapshot-before-update).

### Comments

Lean towards "explain *why*" over "explain *what*". Every cross-service touchpoint (outbox dispatcher, external API client, security-critical helper) has a docstring block at the top explaining the protocol + the failure modes. Read those first when you're trying to understand a module.

---

## Where to look for what

| If you need to… | Look in |
|---|---|
| Add a new user-facing API | `backend/src/<module>/<module>.controller.ts` |
| Add a new admin endpoint | `backend/src/<module>/<module>-admin.controller.ts` + `permissions.ts` |
| Add a DB table | `backend/prisma/schema.prisma` then `npx prisma migrate dev` |
| Add a feature flag | A new migration with `INSERT INTO "FeatureFlag"` |
| Add an email template | A new migration with `INSERT INTO "NotificationTemplate"` |
| Add a setting tunable by ops | A new migration with `INSERT INTO "SystemSetting"` |
| Talk to AWS | Use `backend/src/aws/sigv4.ts` — don't add an `@aws-sdk/*` dep |
| Talk to Bet wallet | Inject `BetWalletService` (`backend/src/bet-wallet/`) |
| Add a cron | `@Cron('…')` decorator on a service method; NestJS `ScheduleModule` auto-registers |
| Add a cross-service side effect | Add an `OutboxKind` + dispatcher; don't call from the HTTP path |
| Issue a JWT | `AuthService.issue()` for sessions, `AuthService.issueShortLivedSsoToken()` for 60s SSO |
| Encrypt a sensitive blob | `DocumentCipher` interface — local in dev, KMS in prod |
| Upload an image | `Storage` interface + `SharpImageProcessor` (`backend/src/storage/`) — EXIF auto-stripped |
| Admin SPA: add a page | `admin/src/pages/<Page>.tsx` + register in `admin/src/App.tsx` route list |
| Auctions SPA: add a page | `auctions/app/<route>/page.tsx` (Next.js App Router) |
| Add a Helm template | `helm/kalki/templates/<service>.yaml` + values in `values.yaml` |

---

## Testing

### Where tests live

Right next to the unit under test, as `<unit>.spec.ts`. No separate `__tests__` dir.

### What we test

- **Every service**: at least one spec covering happy path + 2-3 error/edge cases.
- **Every controller**: at least one spec for permission gating + DTO validation.
- **Every adapter** (`KycStorage`, `VirusScanner`, `DocumentCipher`, `Storage`, `SnsSignatureVerifier`): unit tests using an injected fake (`fetchImpl`, `connectFn`, mock Prisma).
- **Every cron**: at least one spec covering the SKIP-LOCKED-aware path.

### What we don't test

- **No e2e Cypress against the SPAs.** Surface area's too big; admin SPA is loosely typed but the backend is exhaustively tested at the service+controller layer.
- **No load tests in CI.** Done out-of-band against a staging cluster.

### Mocking patterns

The codebase prefers **constructor injection** over global mocks. Every adapter takes its dependency as a constructor parameter so tests pass in a fake:

```typescript
const fake = makeFakeKms(); // returns { fetchImpl, calls }
const cipher = new KmsDocumentCipher(fake.fetchImpl);
await cipher.encrypt(Buffer.from('x'));
expect(fake.calls.length).toBe(1);
```

For Prisma, the convention is a `makePrismaMock()` helper local to each spec (see `email-webhook.service.spec.ts`).

---

## Environment variables

Listed once because there are now ~30 of them. Set in `kalki-shared` Secret for prod; local dev reads `.env` in `backend/`.

### Core

| Var | Purpose | Default |
|---|---|---|
| `KALKI_ROLE` | `api` (default) or `worker` | `api` |
| `NODE_ENV` | `development` / `production` / `test` | `development` |
| `PORT` | HTTP listener port | `4000` |
| `DATABASE_URL` | Postgres connection string | (built from postgres values) |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | Redis | `localhost:6379` / `''` |

### Auth + JWT

| Var | Purpose |
|---|---|
| `JWT_SECRET` | Signs the session JWT. **MUST match across backend + bet.** |
| `BACKEND_JWT_SECRET` | Cross-service shared secret used by Bet to validate backend-issued tokens. |
| `INTERNAL_API_SECRET` | Shared secret on internal-only endpoints. |
| `BCRYPT_ROUNDS` | Password hash cost. Default `10`. |

### Cookie auth (admin SPA, PR-ADMIN-COOKIE-AUTH)

| Var | Purpose | Default |
|---|---|---|
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed origins. When set, enables `credentials: true` + pins origin (browsers reject `*` + credentials). | unset → permissive `*` |
| `ADMIN_COOKIE_SECURE` | `true` / `false` override. | auto: on for non-development, off for dev |
| `ADMIN_COOKIE_DOMAIN` | e.g. `.cloud.podstack.ai` to share cookie across subdomains. | unset → API host only |
| `ADMIN_COOKIE_MAX_AGE_SECONDS` | TTL. | `43200` (12h) |

### KYC adapters

| Var | Purpose | Values |
|---|---|---|
| `KYC_STORAGE_DRIVER` | Where docs land. | `disk` (default) / `s3` |
| `KYC_VIRUS_SCANNER` | Scanner. | `stub` (default) / `clamav` |
| `KYC_CIPHER_DRIVER` | Cipher. | `local` (default) / `kms` |
| `KYC_DOCUMENT_KEY` | Local-cipher master key. Falls back to `JWT_SECRET` in dev. | — |
| `KYC_S3_BUCKET` | S3 bucket for docs. | `kalki-kyc-encrypted` |
| `KYC_S3_KMS_KEY_ID` | KMS key for SSE-KMS. | `alias/kalki/kyc` |
| `KYC_KMS_KEY_ID` | KMS key for envelope encryption. | `alias/kalki/kyc` |
| `CLAMD_HOST` / `CLAMD_PORT` | ClamAV daemon. | `clamd` / `3310` |
| `CLAMD_TIMEOUT_MS` | Scan timeout. | `30000` |

### AWS (shared by SES, S3, KMS)

| Var | Purpose |
|---|---|
| `AWS_REGION` | e.g. `ap-south-1`. |
| `AWS_ACCESS_KEY_ID` | IAM principal. |
| `AWS_SECRET_ACCESS_KEY` | Paired secret. |
| `AWS_SESSION_TOKEN` | Optional, for STS roles. |

### Notifications

| Var | Purpose | Default |
|---|---|---|
| `NOTIFY_FROM_EMAIL` | SES `From` address. | `no-reply@kalki.local` |
| `NOTIFY_WEBHOOK_TOPIC_ARN` | Expected SNS topic ARN. | unset |
| `NOTIFY_SNS_VERIFY` | `true` → RSA-verify SNS payloads. | `false` |

### Razorpay

| Var | Purpose |
|---|---|
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Gateway creds. |
| `RAZORPAY_WEBHOOK_SECRET` | Verify webhook signature. |

### Bet wallet client

| Var | Purpose |
|---|---|
| `BET_BASE_URL` | Bet service endpoint. |

---

## Pitfalls

Read these *before* you trip over them. Each one bit us at least once.

1. **Don't update `User.coinBalance` directly.** The unified balance lives in the Bet wallet service. `/auth/me` overlays the live Bet balance onto the user record. Direct writes to `User.coinBalance` drift and confuse the recon job.

2. **Don't bypass the outbox for cross-service calls.** If you're tempted to `await this.betWallet.debit(…)` inside a request handler, write an `Outbox` row instead. The outage of *any* downstream MUST NOT break user-facing work.

3. **Don't add `@aws-sdk/*` deps.** Use `backend/src/aws/sigv4.ts` (~50 lines, shared). The same applies to TOTP, ClamAV INSTREAM, RFC-spec'd things in general — implement against Node `crypto` first.

4. **Don't put cleartext secrets in the DB.** Use `SecretCipher` (local-key) or `DocumentCipher` (KMS-backed) — both prefix the ciphertext with a version byte so future rotations don't break old rows.

5. **Don't call `prisma.update` then audit without snapshotting first.** The `before` field will lie. Use the snapshot-before-update pattern. See `summary.md`.

6. **Don't `git add -A`.** It's how `.env` gets committed. Add specific files. The `.gitignore` is a safety net, not a guarantee.

7. **Don't skip the migration's `ON CONFLICT DO NOTHING`** for seed inserts. Re-running on every pod boot is a feature, not a bug — but only if your INSERTs are idempotent.

8. **Don't run `prisma migrate dev` on a shared branch.** It'll apply locally + write a new migration directory. If someone else has rebased main with a different migration, you'll have a conflict. Always pull main fresh + sync your local DB before generating.

9. **Don't return raw Prisma errors to the client.** They include the SQL and the row state. Catch `e.code === 'P2002'` (unique) and translate to a `409 ConflictException` with a stable `code`.

10. **Don't trust `req.user` without `@UseGuards(JwtAuthGuard)`.** It's only populated if the guard ran. Public endpoints (like `/share/[id]`) get `undefined`.

11. **Don't enable `clamav.enabled: true` in Helm without a ~1 GB pod request budget.** ClamAV loads the full signature DB into RAM. See `helm/kalki/templates/clamav.yaml` for the resources rationale.

12. **Don't set `replicas: 2` on the worker pod** until `PR-LEADER-ELECT` ships. SKIP LOCKED prevents data corruption but two pods would fire each `@Cron` twice.

13. **Don't drop `android:allowBackup="false"`** from the Android manifest. The encrypted prefs file would otherwise land in adb backup tarballs.

---

*End of developer documentation. If something here is wrong, fix it in the same PR as the code change — docs drift fast.*
