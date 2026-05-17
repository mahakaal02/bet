# Kalki Seed Users — Replace Demo Accounts

**Date:** 2026-05-17
**Status:** Approved
**Scope:** Replace the four `@uniquebid.local` demo accounts with four
`@kalki.local` accounts across the codebase, and apply the change to the
live `kalki` Kubernetes namespace Postgres.

## Goal

The deployed `kalki` namespace currently runs against a database seeded
with `admin@uniquebid.local` plus `demo1/2/3@uniquebid.local`. We want
the live database (and the codebase that produces it) to instead carry
`admin@kalki.local` plus `user1/2/3@kalki.local`, all sharing a single
password.

## Users to seed

| email | username | `isAdmin` | password |
|---|---|---|---|
| `admin@kalki.local` | `admin` | true | `password12345` |
| `user1@kalki.local` | `user1` | false | `password12345` |
| `user2@kalki.local` | `user2` | false | `password12345` |
| `user3@kalki.local` | `user3` | false | `password12345` |

Bcrypt cost stays at 10 (matches the existing seed).

Coin balances are deliberately not set in the seed. The Bet (Kalki
Exchange) service awards `SIGNUP_COIN_BONUS` on the first call to
`/api/internal/users/ensure`, so balances materialise on first sign-in —
this matches the unified-wallet architecture documented in
`UNIFIED_WALLET.md`.

## Removing the legacy demo rows

Prisma `upsert` will not delete the old rows. Both seed files get an
explicit delete at the top of `main()`:

```ts
await prisma.user.deleteMany({
  where: {
    email: { endsWith: '@uniquebid.local' },
    NOT: { email: 'ringmaster@uniquebid.local' },
  },
});
```

The `NOT` clause preserves the **system account** `ringmaster@uniquebid.local`
referenced from `backend/src/bids/bids.service.ts:21` — that is not a demo
user and must survive.

## Files changed in the current codebase

| File | Change |
|---|---|
| `backend/prisma/seed.ts` | New users + legacy delete |
| `bet/prisma/seed.ts` | Same email swap (Bet keys shadow rows by email) |
| `auctions/app/login/LoginForm.tsx` | Quick-pick chips + placeholder |
| `README.md` | Login instructions |
| `backend/README.md` | Seed docstring |
| `aviator/README.md` | Login instructions |
| `bet/README.md` | Stale `@bet.local` mention → `@kalki.local` |

## Intentionally NOT changed

- `backend/src/bids/bids.service.ts` — `RINGMASTER_EMAIL` is a system
  account, not a demo user.
- `bet/scripts/merge-legacy-bet-emails.ts` — historical one-shot
  migration. Its comments document past reality and must not be
  rewritten.
- `app/build.gradle.kts` — `*.uniquebid.local` strings here are **network
  hostnames** for the Android shell, not user emails. Out of scope.

## Applying to the live `kalki` namespace

Approach B: port-forward the in-cluster Postgres and run the seed
locally against it. No image rebuild required.

```bash
# 1. Pull the postgres password from the secret
PGPW=$(kubectl -n kalki get secret kalki-postgres \
  -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)

# 2. Port-forward Postgres in the background
kubectl -n kalki port-forward svc/kalki-postgres 5432:5432 &
PF_PID=$!
sleep 2

# 3. Seed backend DB (uniquebid)
cd backend
DATABASE_URL="postgresql://postgres:${PGPW}@localhost:5432/uniquebid" \
  npx prisma db seed

# 4. Seed bet DB
cd ../bet
DATABASE_URL="postgresql://postgres:${PGPW}@localhost:5432/bet" \
  npx prisma db seed

# 5. Tear down the forward
kill $PF_PID
```

The seed.ts changes also live in git, so the next image build picks
them up for any future fresh-cluster deploys.

## Verification

After the seed runs:

```bash
# Should return 4 kalki users, 0 demo users (ringmaster preserved)
PGPASSWORD=$PGPW psql -h localhost -U postgres -d uniquebid \
  -c "SELECT email, \"isAdmin\" FROM \"User\" ORDER BY email;"
```

Expected rows: `admin@kalki.local` (isAdmin=t), `user1/2/3@kalki.local`
(isAdmin=f), plus `ringmaster@uniquebid.local` if it already existed.

Then a manual login at the auctions URL with
`admin@kalki.local / password12345` must succeed and grant admin
access.

## Out of scope

- Rebuilding/redeploying backend or bet container images.
- Changing the unified-wallet bonus amount.
- Touching the Android shell build.
- Updating the snapshot at `~/Downloads/kalki-bet-prod` (it's a frozen
  deployment bundle, not a source of truth).
