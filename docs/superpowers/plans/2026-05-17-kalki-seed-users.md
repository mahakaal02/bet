# Kalki Seed Users — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace four `@uniquebid.local` demo accounts with
`admin@kalki.local` + `user1/2/3@kalki.local` (shared password
`password12345`) across the codebase, then apply the change to the
live `kalki` Kubernetes namespace's Postgres.

**Architecture:** Edit the two prisma seed files + a handful of
hardcoded references (login UI, READMEs). Apply to live by
port-forwarding `kalki-postgres` and running both seeds locally
against it. No image rebuild — seed.ts is not part of the running
container's request path.

**Tech Stack:** TypeScript, Prisma 5, NestJS (backend), Next.js 15
(bet/auctions), bcrypt (backend), Postgres 16, Kubernetes.

**Source spec:** `docs/superpowers/specs/2026-05-17-kalki-seed-users-design.md`

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `backend/prisma/seed.ts` | Modify | Delete legacy demo rows (preserving `ringmaster@uniquebid.local`); upsert 4 kalki users |
| `bet/prisma/seed.ts` | Modify | Same delete; upsert 4 kalki users with seeded wallet balances (admin 50000, users 10000) |
| `auctions/app/login/LoginForm.tsx` | Modify | Quick-pick chips, admin chip, placeholder, password copy |
| `README.md` (root) | Modify | Login instructions in "Run it end-to-end" section |
| `backend/README.md` | Modify | Seed docstring line |
| `aviator/README.md` | Modify | Login instructions |
| `bet/README.md` | Modify | Replace stale `@bet.local` line with `@kalki.local` |

Untouched on purpose:
- `backend/src/bids/bids.service.ts` — `RINGMASTER_EMAIL` is a system account.
- `bet/scripts/merge-legacy-bet-emails.ts` — historical migration doc.
- `app/build.gradle.kts` — network hostnames, not user emails.

---

## Task 1: Update `backend/prisma/seed.ts`

**Files:**
- Modify: `backend/prisma/seed.ts:17-42`

- [ ] **Step 1: Replace the demo-user block**

Open `backend/prisma/seed.ts`. The current block from line 17 to line 42 is:

```ts
  const adminPassword = await bcrypt.hash('admin123', 10);
  await prisma.user.upsert({
    where: { email: 'admin@uniquebid.local' },
    update: {},
    create: {
      email: 'admin@uniquebid.local',
      username: 'admin',
      passwordHash: adminPassword,
      emailVerified: true,
      isAdmin: true,
    },
  });

  const demoPassword = await bcrypt.hash('demo1234', 10);
  for (let i = 1; i <= 3; i++) {
    await prisma.user.upsert({
      where: { email: `demo${i}@uniquebid.local` },
      update: {},
      create: {
        email: `demo${i}@uniquebid.local`,
        username: `demo${i}`,
        passwordHash: demoPassword,
        emailVerified: true,
      },
    });
  }
```

Replace it verbatim with:

```ts
  // Purge any pre-existing @uniquebid.local demo accounts so a re-seed
  // produces a clean kalki-only state. The ringmaster sentinel
  // (see src/bids/bids.service.ts) is a system row, not a demo user — skip it.
  await prisma.user.deleteMany({
    where: {
      email: { endsWith: '@uniquebid.local' },
      NOT: { email: 'ringmaster@uniquebid.local' },
    },
  });

  const sharedPassword = await bcrypt.hash('password12345', 10);
  await prisma.user.upsert({
    where: { email: 'admin@kalki.local' },
    update: { passwordHash: sharedPassword, isAdmin: true, emailVerified: true },
    create: {
      email: 'admin@kalki.local',
      username: 'admin',
      passwordHash: sharedPassword,
      emailVerified: true,
      isAdmin: true,
    },
  });

  for (let i = 1; i <= 3; i++) {
    await prisma.user.upsert({
      where: { email: `user${i}@kalki.local` },
      update: { passwordHash: sharedPassword, emailVerified: true },
      create: {
        email: `user${i}@kalki.local`,
        username: `user${i}`,
        passwordHash: sharedPassword,
        emailVerified: true,
      },
    });
  }
```

- [ ] **Step 2: Type-check the file**

Run from repo root:

```bash
cd backend && npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors. If a Prisma type error appears about `NOT` /
`endsWith`, regenerate the client with `npx prisma generate`.

- [ ] **Step 3: Smoke-run the seed against a throwaway local DB**

This validates the SQL before touching the live cluster.

```bash
# Start a disposable postgres on a non-default port
docker run --rm -d --name kalki-seed-test \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=uniquebid \
  -p 55432:5432 postgres:16-alpine
sleep 5

# Apply migrations then seed
cd backend
DATABASE_URL="postgresql://postgres:test@localhost:55432/uniquebid" \
  npx prisma migrate deploy
DATABASE_URL="postgresql://postgres:test@localhost:55432/uniquebid" \
  npm run prisma:seed
```

Expected output: no errors, no stack traces. The seed prints nothing
on success (current behaviour).

- [ ] **Step 4: Verify the rows**

```bash
PGPASSWORD=test psql -h localhost -p 55432 -U postgres -d uniquebid \
  -c 'SELECT email, username, "isAdmin" FROM "User" ORDER BY email;'
```

Expected exactly 4 rows:

```
        email         | username | isAdmin
----------------------+----------+---------
 admin@kalki.local    | admin    | t
 user1@kalki.local    | user1    | f
 user2@kalki.local    | user2    | f
 user3@kalki.local    | user3    | f
```

No `@uniquebid.local` rows. Tear down:

```bash
docker rm -f kalki-seed-test
```

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/seed.ts
git commit -m "feat(backend): seed kalki.local users in place of demo accounts"
```

---

## Task 2: Update `bet/prisma/seed.ts`

**Files:**
- Modify: `bet/prisma/seed.ts:6-46`

- [ ] **Step 1: Replace the demo-user block**

The current block at lines 6–46 starts with the `// ─── Users ─────` comment and ends at the closing `}` of the demos loop. Replace those lines verbatim with:

```ts
  // ─── Users ───────────────────────────────────────────────────────────
  //
  // Bet no longer stores credentials — the auctions backend is the
  // single source of truth for user identity (see `lib/auth.ts`). Seed
  // Bet User rows ONLY as wallet anchors keyed to the backend's seeded
  // accounts. Emails match `backend/prisma/seed.ts` exactly so the same
  // login works on all three product surfaces.
  //
  // `passwordHash` is intentionally null on every row — the credentials
  // provider on Bet won't even look at it.
  //
  // Purge legacy @uniquebid.local demo rows so a re-seed produces a
  // clean kalki-only state. (No ringmaster on the bet side, but we keep
  // the NOT clause so the two seeds stay symmetrical.)
  await db.user.deleteMany({
    where: {
      email: { endsWith: "@uniquebid.local" },
      NOT: { email: "ringmaster@uniquebid.local" },
    },
  });

  const admin = await db.user.upsert({
    where: { email: "admin@kalki.local" },
    update: { isAdmin: true },
    create: {
      email: "admin@kalki.local",
      username: "admin",
      isAdmin: true,
      referralCode: "ADMIN1",
      wallet: { create: { balance: 50000 } },
    },
  });

  // Demo traders — mirror backend's user1/2/3 accounts.
  const demos: { id: string }[] = [];
  for (let i = 1; i <= 3; i++) {
    const u = await db.user.upsert({
      where: { email: `user${i}@kalki.local` },
      update: {},
      create: {
        email: `user${i}@kalki.local`,
        username: `user${i}`,
        referralCode: `USER0${i}`,
        xp: Math.floor(Math.random() * 600),
        wallet: { create: { balance: 10000 } },
      },
    });
    demos.push({ id: u.id });
  }
```

Notes:
- Demo count drops from 5 → 3 (matches the spec's "user1/2/3"). The
  `demos` array is consumed downstream for trade/achievement seeding;
  going from 5 to 3 is safe — those loops iterate `demos.length`.
- `referralCode` uses `USER01/USER02/USER03` to preserve the existing
  "ALL CAPS 6-char" pattern (`ADMIN1`, `DEMO01`).
- `wallet.create` matches the prior balances (50,000 / 10,000) so the
  in-app demo experience is unchanged.

- [ ] **Step 2: Search for any reference to demo4/demo5 elsewhere in seed.ts**

```bash
grep -n "demo4\|demo5\|demos\[3\]\|demos\[4\]" bet/prisma/seed.ts
```

Expected: zero matches. If matches appear, the downstream code
indexes past `demos.length=3`; fix by clamping the index or trimming
the consumer to `i < demos.length`. Report any matches in the commit
message.

- [ ] **Step 3: Type-check**

```bash
cd bet && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Smoke-run the seed**

```bash
# Reuse the disposable postgres from Task 1 — start a fresh one if torn down
docker run --rm -d --name kalki-seed-test \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=bet \
  -p 55432:5432 postgres:16-alpine
sleep 5

cd bet
DATABASE_URL="postgresql://postgres:test@localhost:55432/bet" \
  npx prisma migrate deploy
DATABASE_URL="postgresql://postgres:test@localhost:55432/bet" \
  npm run prisma:seed
```

Expected: ends with the existing summary line, now reading
`Seeded N markets, 3 demo Bet shadow users (auth lives on the backend) + admin@kalki.local, M achievements`.

(That summary line itself lives further down in `seed.ts` and
currently hardcodes `admin@uniquebid.local`. The literal swap happens
in this same file — do it as the next step.)

- [ ] **Step 5: Update the summary log line**

Find `bet/prisma/seed.ts:223` (or wherever it ended up after edits):

```ts
    `Seeded ${markets.length} markets, ${demos.length} demo Bet shadow users (auth lives on the backend) + admin@uniquebid.local, ${achievements.length} achievements`,
```

Replace `admin@uniquebid.local` with `admin@kalki.local`. No other change.

- [ ] **Step 6: Re-run and verify the rows**

```bash
DATABASE_URL="postgresql://postgres:test@localhost:55432/bet" \
  npm run prisma:seed

PGPASSWORD=test psql -h localhost -p 55432 -U postgres -d bet \
  -c 'SELECT u.email, u.username, u."isAdmin", w.balance
      FROM "User" u LEFT JOIN "Wallet" w ON w."userId" = u.id
      ORDER BY u.email;'
```

Expected:

```
        email         | username | isAdmin | balance
----------------------+----------+---------+---------
 admin@kalki.local    | admin    | t       |   50000
 user1@kalki.local    | user1    | f       |   10000
 user2@kalki.local    | user2    | f       |   10000
 user3@kalki.local    | user3    | f       |   10000
```

Tear down:

```bash
docker rm -f kalki-seed-test
```

- [ ] **Step 7: Commit**

```bash
git add bet/prisma/seed.ts
git commit -m "feat(bet): seed kalki.local shadow users in place of demo accounts"
```

---

## Task 3: Update `auctions/app/login/LoginForm.tsx`

**Files:**
- Modify: `auctions/app/login/LoginForm.tsx:8-24` (constants + docstring)
- Modify: `auctions/app/login/LoginForm.tsx:75` (input placeholder)
- Modify: `auctions/app/login/LoginForm.tsx:88` (password placeholder)
- Modify: `auctions/app/login/LoginForm.tsx:99-110` (demo chip onClick password + label)

- [ ] **Step 1: Replace the constants and docstring**

Replace lines 8–24:

```tsx
/**
 * Demo accounts seeded in the auctions backend (see
 * `backend/prisma/seed.ts`). All have password `demo1234`. We show them
 * as click-to-fill chips so the user can flip between identities while
 * testing real-time bid updates — open one browser as demo1, another
 * as demo2, watch the "outbid" status flip live.
 */
const DEMO_USERS = [
  { email: "demo1@uniquebid.local", label: "demo1" },
  { email: "demo2@uniquebid.local", label: "demo2" },
  { email: "demo3@uniquebid.local", label: "demo3" },
];
const ADMIN_USER = {
  email: "admin@uniquebid.local",
  password: "admin123",
  label: "admin",
};
```

With:

```tsx
/**
 * Seed accounts created by `backend/prisma/seed.ts` and
 * `bet/prisma/seed.ts`. All four share the password `password12345`.
 * Chip-to-fill helps QA flip between identities while testing
 * real-time bid updates — open one browser as user1, another as
 * user2, watch the "outbid" status flip live.
 */
const SHARED_PASSWORD = "password12345";
const DEMO_USERS = [
  { email: "user1@kalki.local", label: "user1" },
  { email: "user2@kalki.local", label: "user2" },
  { email: "user3@kalki.local", label: "user3" },
];
const ADMIN_USER = {
  email: "admin@kalki.local",
  password: SHARED_PASSWORD,
  label: "admin",
};
```

- [ ] **Step 2: Update the email placeholder (line 75)**

```tsx
          placeholder="user1@kalki.local"
```

- [ ] **Step 3: Update the password placeholder (line 88)**

```tsx
          placeholder="password12345"
```

- [ ] **Step 4: Update the chip-fill password (currently hardcoded `"demo1234"` on line ~109)**

The `onClick` body currently reads:

```tsx
                onClick={() => {
                  setEmail(u.email);
                  setPassword("demo1234");
                }}
```

Change to:

```tsx
                onClick={() => {
                  setEmail(u.email);
                  setPassword(SHARED_PASSWORD);
                }}
```

- [ ] **Step 5: Update the "password" hint copy (line ~100)**

The block reads:

```tsx
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Demo users · password{" "}
            <code className="rounded bg-slate-800 px-1 text-slate-300">demo1234</code>
          </p>
```

Change the code text to `password12345`:

```tsx
            <code className="rounded bg-slate-800 px-1 text-slate-300">password12345</code>
```

- [ ] **Step 6: Type-check and lint**

```bash
cd auctions && npx tsc --noEmit
```

Expected: zero errors. No new lint script change — the file's
existing import surface is unchanged.

- [ ] **Step 7: Commit**

```bash
git add auctions/app/login/LoginForm.tsx
git commit -m "feat(auctions): point login chips at kalki.local seed users"
```

---

## Task 4: Update READMEs

Four READMEs reference the old demo emails / passwords. Each change is a single line replace.

**Files:**
- Modify: `README.md` (root) — lines 41, 47
- Modify: `backend/README.md` — line 44
- Modify: `aviator/README.md` — line 16
- Modify: `bet/README.md` — line 52

- [ ] **Step 1: Edit `README.md` (root)**

Line 41 currently:

```
Open <http://localhost:5173>, sign in as `admin@uniquebid.local` / `admin123`,
```

Change to:

```
Open <http://localhost:5173>, sign in as `admin@kalki.local` / `password12345`,
```

Line 47 currently:

```
at `10.0.2.2:4000`). Sign in as `demo1@uniquebid.local` / `demo1234`.
```

Change to:

```
at `10.0.2.2:4000`). Sign in as `user1@kalki.local` / `password12345`.
```

- [ ] **Step 2: Edit `backend/README.md`**

Line 44 currently:

```
npm run prisma:seed   # creates admin@uniquebid.local / admin123 and 3 demo users
```

Change to:

```
npm run prisma:seed   # creates admin@kalki.local / password12345 and 3 user accounts (user1-3)
```

- [ ] **Step 3: Edit `aviator/README.md`**

Line 16 currently:

```
Sign in with any seeded user (`demo1@uniquebid.local` / `demo1234`).
```

Change to:

```
Sign in with any seeded user (`user1@kalki.local` / `password12345`).
```

- [ ] **Step 4: Edit `bet/README.md`**

Line 52 currently:

```
Seeded admin: `admin@bet.local` / `admin123` · Demos: `demo1@bet.local` … `demo5@bet.local` / `demo1234`.
```

Change to:

```
Seeded admin: `admin@kalki.local` / `password12345` · Demos: `user1@kalki.local` … `user3@kalki.local` / `password12345`.
```

- [ ] **Step 5: Verify no stale `@uniquebid.local` / `@bet.local` references in user-facing files remain**

```bash
grep -rn "uniquebid\.local\|bet\.local\|admin123\|demo1234" \
  README.md backend/README.md aviator/README.md bet/README.md \
  auctions/app/login/LoginForm.tsx
```

Expected: only the lines inside `bet/scripts/merge-legacy-bet-emails.ts`
(which we deliberately leave alone — pass `--exclude-dir=scripts` if
the grep is widened). For the file list above the expected output is
**empty**.

- [ ] **Step 6: Commit**

```bash
git add README.md backend/README.md aviator/README.md bet/README.md
git commit -m "docs: update login docs to kalki.local seed accounts"
```

---

## Task 5: Apply to the live `kalki` namespace

This task runs against the live cluster Postgres. No image rebuild;
the seeds run from the local checkout against a port-forwarded
connection.

**Pre-flight:**

- [ ] **Step 1: Verify cluster context**

```bash
kubectl config current-context
kubectl -n kalki get pods
```

Expected: a context that resolves the `kalki` namespace, and pods
showing `kalki-postgres-0` plus `kalki-backend-*` and `kalki-bet-*`
all `Running`. If `kalki-postgres-0` is not `Running`, stop and
investigate — do not attempt to seed.

- [ ] **Step 2: Pull the postgres password from the secret**

```bash
PGPW=$(kubectl -n kalki get secret kalki-postgres \
  -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)
echo "len=${#PGPW}"
```

Expected: a non-zero length. Do **not** echo the password itself.

- [ ] **Step 2a: FK pre-flight (added after Task 1 code review)**

The seed's `deleteMany` will fail if any `@uniquebid.local` user has
rows in tables whose FK to `User` lacks `onDelete: Cascade`. Check
both DBs before snapshotting.

```bash
kubectl -n kalki port-forward svc/kalki-postgres 5432:5432 &
PF_PID=$!
sleep 3
PGPASSWORD=$PGPW psql -h localhost -U postgres -d uniquebid <<'SQL'
SELECT u.email,
       (SELECT COUNT(*) FROM "Bid"             b WHERE b."userId" = u.id) AS bids,
       (SELECT COUNT(*) FROM "CoinTransaction" t WHERE t."userId" = u.id) AS coin_tx,
       (SELECT COUNT(*) FROM "AviatorBet"      a WHERE a."userId" = u.id) AS aviator_bets,
       (SELECT COUNT(*) FROM "AviatorChatMessage" c WHERE c."userId" = u.id) AS aviator_msgs
FROM "User" u
WHERE u.email LIKE '%@uniquebid.local'
  AND u.email <> 'ringmaster@uniquebid.local';
SQL
PGPASSWORD=$PGPW psql -h localhost -U postgres -d bet <<'SQL'
SELECT u.email,
       (SELECT COUNT(*) FROM "Transaction" t WHERE t."userId" = u.id) AS tx,
       (SELECT COUNT(*) FROM "Position"    p WHERE p."userId" = u.id) AS positions,
       (SELECT COUNT(*) FROM "Trade"       tr WHERE tr."userId" = u.id) AS trades,
       (SELECT COUNT(*) FROM "Report" r WHERE r."resolverId" = u.id) AS reports_resolved,
       (SELECT COUNT(*) FROM "WithdrawalRequest" w WHERE w."decidedById" = u.id) AS withdrawals_decided
FROM "User" u
WHERE u.email LIKE '%@uniquebid.local';
SQL
kill $PF_PID; wait $PF_PID 2>/dev/null || true
```

Expected: all counts zero in both DBs.

**If any count is non-zero:** STOP. The demo rows have transactional
history that would be cascade-deleted alongside the user (or the
deletion would fail outright). Surface the counts to the human and
ask before proceeding — either accept the cascade as part of "demo
account replacement" (delete the history too) or back out the
deleteMany and prune manually.

- [ ] **Step 3: Snapshot the live tables before changes**

```bash
mkdir -p /tmp/kalki-seed-backup
kubectl -n kalki exec kalki-postgres-0 -- \
  pg_dump -U postgres -d uniquebid -t '"User"' --data-only \
  > /tmp/kalki-seed-backup/uniquebid-User-pre.sql
kubectl -n kalki exec kalki-postgres-0 -- \
  pg_dump -U postgres -d bet -t '"User"' -t '"Wallet"' --data-only \
  > /tmp/kalki-seed-backup/bet-User-Wallet-pre.sql
ls -la /tmp/kalki-seed-backup
```

Expected: both files non-empty. If either is empty, the
in-cluster pg_dump failed — check the pod name and PGUSER env.

- [ ] **Step 4: Port-forward Postgres**

```bash
kubectl -n kalki port-forward svc/kalki-postgres 5432:5432 &
PF_PID=$!
sleep 3
# Sanity-check the forward is live
PGPASSWORD=$PGPW psql -h localhost -U postgres -d uniquebid -c 'SELECT 1;'
```

Expected: `?column? \n----\n 1`. If the psql call hangs or errors,
something is using local port 5432 — kill it (`lsof -i:5432`), then
retry.

- [ ] **Step 5: Seed the auctions backend DB**

```bash
cd backend
DATABASE_URL="postgresql://postgres:${PGPW}@localhost:5432/uniquebid" \
  npm run prisma:seed
```

Expected: no errors. The seed prints nothing on success.

- [ ] **Step 6: Verify the backend DB**

```bash
PGPASSWORD=$PGPW psql -h localhost -U postgres -d uniquebid \
  -c 'SELECT email, username, "isAdmin" FROM "User" ORDER BY email;'
```

Expected rows (`ringmaster@uniquebid.local` shows up **only if** the
running backend has placed any bids; that's normal):

```
            email             | username   | isAdmin
------------------------------+------------+---------
 admin@kalki.local            | admin      | t
 ringmaster@uniquebid.local   | ringmaster | f       (optional)
 user1@kalki.local            | user1      | f
 user2@kalki.local            | user2      | f
 user3@kalki.local            | user3      | f
```

If any `@uniquebid.local` row other than `ringmaster` remains, stop:
the delete clause did not fire. Investigate before continuing.

- [ ] **Step 7: Seed the bet DB**

```bash
cd ../bet
DATABASE_URL="postgresql://postgres:${PGPW}@localhost:5432/bet" \
  npm run prisma:seed
```

Expected: ends with the summary line including `admin@kalki.local`.

- [ ] **Step 8: Verify the bet DB**

```bash
PGPASSWORD=$PGPW psql -h localhost -U postgres -d bet \
  -c 'SELECT u.email, u.username, u."isAdmin", w.balance
      FROM "User" u LEFT JOIN "Wallet" w ON w."userId" = u.id
      WHERE u.email LIKE '"'"'%@kalki.local'"'"'
      ORDER BY u.email;'
```

Expected: 4 rows — admin (50000), user1/2/3 (10000 each).

- [ ] **Step 9: Tear down the port-forward**

```bash
kill $PF_PID
wait $PF_PID 2>/dev/null || true
```

- [ ] **Step 10: End-to-end login smoke test**

In a browser, hit the auctions URL (the value of
`https://kalki-auctions.<your-cluster-domain>` per your helm
`values.yaml` `global.domain` / `hostnamePrefix`):

1. Click the **admin** chip on the login form (or paste
   `admin@kalki.local` / `password12345`).
2. Confirm successful sign-in and presence of admin-only UI affordances.
3. Sign out, sign in as `user1@kalki.local` / `password12345`. Confirm
   the user lands on the auctions home page, wallet shows ≈ 10,000 coins
   (or 0 if Bet hasn't yet served `/api/me` — refresh once).

If any step fails, restore from the snapshot in Step 3:

```bash
PGPASSWORD=$PGPW psql -h localhost -U postgres -d uniquebid \
  -c 'TRUNCATE "User" CASCADE;' \
  -f /tmp/kalki-seed-backup/uniquebid-User-pre.sql
PGPASSWORD=$PGPW psql -h localhost -U postgres -d bet \
  -c 'TRUNCATE "User", "Wallet" CASCADE;' \
  -f /tmp/kalki-seed-backup/bet-User-Wallet-pre.sql
```

(The port-forward needs to be running for the restore — re-run Step 4
if you already tore it down.)

- [ ] **Step 11: Final note in commit history**

This task does not produce a commit (it only runs against a live DB),
but tag the rollout in your local notes / runbook with the commit SHA
of Task 4. Future cluster bring-ups (or image rebuilds) will pick up
the seed file changes automatically.

---

## Self-review pass

Run through the checks the writing-plans skill calls for:

- **Spec coverage:** All four seeded users named in the spec are
  covered (Task 1 + Task 2). Legacy delete covered. All file edits
  from the spec's "Files changed" table have tasks. Apply-to-cluster
  covered. Verification covered. ✓
- **Placeholder scan:** No TBD/TODO/handwaving. Every code block is
  the exact replacement text. Every command is runnable as written. ✓
- **Type consistency:** `SHARED_PASSWORD` constant introduced in
  Task 3 is used consistently. `referralCode` pattern matches the
  existing 6-char ALL CAPS convention. `kalki` namespace name, DB
  names (`uniquebid`, `bet`), and pod names align with the helm
  chart values. ✓
