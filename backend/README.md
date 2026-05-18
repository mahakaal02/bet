# UniqueBid — Backend (Slice 1)

NestJS + Prisma + Postgres + Redis + raw WebSocket gateway. Implements the
lowest-unique-bid algorithm, atomic bid placement, realtime status streaming,
and admin coin-economy config.

## What's in here

- **`src/bids/bidding-engine.ts`** — pure functions: `classifyCandidate` and
  `selectWinner`. The entire business rule of UniqueBid lives here, with no
  I/O. Read this file first; everything else is plumbing.
- **`src/bids/bidding-engine.spec.ts`** — exhaustive Jest tests covering the
  spec example, the four status states, decimal-precision edge cases, and
  winner-selection corner cases.
- **`src/bids/bid.gateway.ts`** — raw WebSocket gateway at `ws://host:4000/ws`.
  Clients subscribe to an auction with a JWT, send candidate amounts, receive
  status updates. When ANY bid is placed via REST, every subscriber's last
  candidate is re-classified and pushed.
- **`src/bids/bids.service.ts`** — atomic bid placement using a Postgres row
  lock on the user row (`FOR UPDATE`) inside a transaction. Prevents
  double-spend even under concurrent placement.
- **`src/auctions/auctions.service.ts`** — `close()` snapshots all bids and
  runs `selectWinner` inside a transaction. Idempotent.
- **`src/coins/coin-settings.service.ts`** — admin-configurable INR/coin and
  default coins-per-bid, cached in Redis with 60s TTL.
- **`prisma/schema.prisma`** — schema with `DECIMAL(12, 2)` amounts and an
  `(auctionId, amount)` index for fast classification.

## Setup

### Prerequisites

- Node.js 20+
- Docker (for Postgres + Redis)

### Install + bring up infra

```bash
cd backend
cp .env.example .env
npm install
docker compose up -d
npx prisma migrate dev --name init
npm run prisma:seed   # creates admin@kalki.local / password12345 and 3 user accounts (user1-3)
```

### Run the engine tests (no DB needed)

```bash
npm test
```

This runs `bidding-engine.spec.ts` — the algorithm tests are pure and
fast (~50ms). They cover the spec example (A=0.73, B=0.73, C=1.12, D=3.34
→ winner C at 1.12), the three status classes, and decimal-precision edge
cases (0.1 + 0.2, 0.5 vs 0.50).

### Run the server

```bash
npm run start:dev
```

Listens on `:4000`. The Android app's debug build is already pointed at
`http://10.0.2.2:4000/` and `ws://10.0.2.2:4000/ws`.

## REST API

All endpoints except `auth/*` require `Authorization: Bearer <jwt>`.

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | `{ email, username, password }` → `{ token, user }` |
| POST | `/auth/login` | `{ email, password }` → `{ token, user }` |
| GET | `/auth/me` | current user |
| GET | `/auctions` | list live auctions |
| GET | `/auctions/:id` | auction detail |
| POST | `/auctions/:id/bid-status` | `{ amount }` → `{ kind, amount }`. No write. |
| POST | `/auctions/:id/bids` | `{ amount }` → places the bid; debits coins atomically |
| GET | `/admin/coin-settings` | admin: read coin economy |
| PATCH | `/admin/coin-settings` | admin: `{ inrPerCoin?, defaultCoinsPerBid? }` |
| POST | `/admin/auctions` | admin: create auction |
| POST | `/admin/auctions/:id/close` | admin: snapshot bids, pick winner, mark ended |

## WebSocket protocol

Connect to `ws://host:4000/ws`. JSON messages.

**Client → Server**

```json
{ "type": "subscribe", "auctionId": "a1", "token": "<jwt>" }
{ "type": "candidate", "amount": "0.73" }
{ "type": "unsubscribe" }
```

**Server → Client**

```json
{ "type": "subscribed", "auctionId": "a1" }
{ "type": "status", "auctionId": "a1", "amount": "0.73", "kind": "WINNING" }
{ "type": "error", "message": "..." }
```

The server NEVER sends other users' amounts or counts — only the status kind.
This is the fairness contract and is encoded in the gateway by sending only
the four allowed message shapes above.

## Concurrency notes

- **Bid placement**: per-user serialization via `SELECT ... FOR UPDATE` on
  the user row in a transaction. Two concurrent placements from the same
  user can't both pass the coin balance check.
- **Auction close**: a Postgres transaction snapshots all bids and runs the
  winner algorithm. Idempotent — closing an already-ended auction is a
  no-op. A Redis advisory lock (`RedisService.withLock`) is available for
  flows where you need broader cross-process serialization.
- **Status query**: read-only, eventually consistent. Safe to call freely.

## What's NOT here (later slices)

- Email verification, password reset, refresh tokens
- Payment integration (Razorpay / Stripe / Play Billing)
- Rate limiting / anti-bot (need `@nestjs/throttler` + per-IP/per-user limits)
- Push notifications (FCM)
- Auction scheduler (the `close` endpoint exists; the cron that calls it
  automatically when `endsAt` passes does not yet)
- Audit log of admin changes
- Production-grade observability (logs, metrics, tracing)
