# Unified wallet — Kalki Bet platform

**1 coin = ₹1.** One coin balance per user, used across all three games:

- **Kalki Exchange** (Bet) — prediction markets
- **Live Auctions** — lowest-unique-bid auctions
- **Aviator** — multiplier crash game

If a user doubles their coins in Aviator, those coins are immediately
spendable in markets or auctions. Winnings from a resolved market land in
the same balance an auction bid would draw from. No per-game wallets, no
sync jobs, no eventual consistency.

## Money model

Real INR ↔ coins, strict 1:1.

- **Top-up:** user buys coins via Razorpay. ₹500 paid → 500 coins
  credited. Defined in `bet/lib/coin-packs.ts` — packs always satisfy
  `coins === priceInr`. The Razorpay verify route refuses a pack whose
  ratio is off, so even a misconfigured catalog can't accidentally
  discount coins.
- **In-game movement:** every coin debit/credit during play (place bid,
  win auction, buy YES, sell on AMM, etc.) runs through the same
  authoritative Wallet table. No app stores coin state on the client.
- **Withdrawal:** user requests a payout to UPI or bank. Coins are
  **locked at submit time** (debited from `Wallet.balance`, audit row
  with `kind="withdrawal_lock"`). Admin reviews + decides. APPROVED →
  admin runs the actual payout in Razorpay's dashboard, comes back and
  marks `PAID` with the payout reference. REJECTED / CANCELLED →
  compensating `kind="withdrawal_refund"` credit returns the coins.

## Tamper-proof model

Real-money platform → assume the client is hostile. The architecture
makes wallet manipulation impossible without backend compromise:

| Vector | Mitigation |
|---|---|
| Modded Android app fakes a balance | App displays only what `/api/me` returns. The DB number is the truth — a faked local balance vanishes on the next refresh. |
| Patched APK calls debited APIs locally | All wallet movements require an HTTP call to the server. The server checks JWT, balance, idempotency, rate limits. The app cannot mint coins. |
| Forged "I won" claim | Auction close, Aviator crash, and market resolution are all admin- or server-driven. The client never tells the server it won — the server decides. |
| Replayed Razorpay verify | `Transaction.uniq_kind_reference` short-circuits any replay. The webhook + the client-verify route can both fire, only one credits. |
| Spoofed Razorpay payment | HMAC verification with `RAZORPAY_KEY_SECRET`. A forged signature can't survive the constant-time compare. |
| Bot spams withdrawals | `email_not_verified` block + 3-per-hour rate limit + admin gate. The locked coins stay locked across replays, no possibility of double-withdrawal. |
| Cross-account collusion to siphon out a single account's deposit | Admin audit page surfaces transaction breakdown by kind, position P/L vs cost basis, and IP overlap with other accounts. Withdrawals only release on admin click. |

The Android app embeds Aviator and Kalki Exchange as WebViews — that's
not a security choice, it's an architectural one (both apps are
server-rendered Next.js sites). The Live Auctions tab is a native Compose
screen but the same rules apply: every coin op is an authenticated REST
call. **Modding the native UI can't create coins** because the server
doesn't trust the client for anything that affects the wallet.

## Architecture

**Kalki Exchange (`bet/`) is the canonical wallet authority.** It owns:

- `Wallet.balance` — the integer coin balance, one row per user
- `Transaction` — append-only audit log with idempotency on
  `(kind, reference)` so any caller can retry safely
- The `/api/wallet/topup` route — user-facing purchase flow
- The `/api/internal/wallet` route — **server-to-server** debit / credit /
  balance ops for the other two apps

The auctions backend and Aviator service call into `bet`'s wallet over
HTTP (LAN-local in dev, private VPC peering in prod) authenticated with a
shared `INTERNAL_API_SECRET`. They no longer maintain their own balance
columns — they pass through to the canonical source.

```
                       ┌──────────────────────────┐
                       │   Kalki Exchange (bet/)  │
                       │                          │
                       │   Postgres `bet` DB      │
                       │   ┌──────────────────┐   │
                       │   │ Wallet           │◄──┼─── /api/internal/wallet
                       │   │ Transaction      │   │     (Bearer secret)
                       │   └──────────────────┘   │
                       │                          │
                       │   /api/wallet/topup ─────┼─── User-facing buy flow
                       │                          │     (placeholder today,
                       │                          │      Razorpay tomorrow)
                       └────────────▲─────────────┘
                                    │
                ┌───────────────────┼────────────────────┐
                │                   │                    │
        ┌───────┴────────┐  ┌───────┴────────┐  ┌────────┴────────┐
        │ Auctions       │  │ Aviator        │  │ Bet itself      │
        │ (NestJS :4000) │  │ (Next :3000)   │  │ trade / resolve │
        │                │  │                │  │ daily / etc.    │
        │ POST debit on  │  │ POST debit on  │  │ writes Wallet   │
        │ bid placement  │  │ round start    │  │ via Prisma in   │
        │ POST credit on │  │ POST credit on │  │ the same DB     │
        │ auction win    │  │ cashout        │  │                 │
        └────────────────┘  └────────────────┘  └─────────────────┘
```

## API contract — `/api/internal/wallet`

```
POST /api/internal/wallet
Authorization: Bearer <INTERNAL_API_SECRET>
Content-Type: application/json
```

Body is a discriminated union on `op`:

### Debit

```json
{
  "op": "debit",
  "userId": "cmp70m3e10002oxvr6e4q3bpx",
  "amount": 100,
  "kind": "auction_bid",
  "reference": "bid:abc123",
  "metadata": { "auctionId": "sony-headphones-2026" }
}
```

- `amount` is in **coins** (integer, 1 ≤ amount ≤ 10,000,000).
- `kind` + `reference` are unique together. A replay returns
  `{ ok:true, duplicate:true, balance:<current> }` — safe to retry.
- Insufficient funds → `400 { error:"insufficient_coins", balance:<current> }`.
- Unknown user → `404 { error:"user_not_found" }`.

### Credit

Same shape, `op: "credit"`. Always succeeds (modulo replays) — the wallet
column has no upper bound.

### Balance read

```json
{ "op": "balance", "userId": "..." }
```

Returns `{ ok:true, balance:<int> }`. No DB write.

## Idempotency convention

Every caller MUST pass a stable `(kind, reference)`. Examples that already
exist inside `bet/` itself:

| kind | reference | source |
|---|---|---|
| `wallet_topup` | `<paymentRef>` | `/api/wallet/topup` |
| `trade_buy` | `<tradeId>` | AMM trade route |
| `smart_buy_amm` | `<tradeId>` | smart-route AMM leg |
| `smart_buy_book` | `<tradeId>` | smart-route book leg |
| `daily_claim` | `daily:<userId>:<YYYY-MM-DD>` | daily faucet |
| `referral_bonus` | `referral:<newUserId>` | register flow |
| `resolution_payout` | `<outcome>:<marketId>:<positionId>` | resolve route |
| `achievement_reward` | `ach:<achCode>:<userId>` | achievement engine |

Suggested conventions for the other two apps:

| kind | reference |
|---|---|
| `auction_bid` | `bid:<bidId>` |
| `auction_refund` | `refund:<bidId>` |
| `auction_win` | `win:<auctionId>:<userId>` |
| `aviator_stake` | `aviator:<roundId>:<userId>` |
| `aviator_cashout` | `aviator-cash:<roundId>:<userId>` |

## What ships today (Phase 0)

1. `bet/`'s wallet schema is the single source of truth for the
   prediction-market app. All trade / resolve / faucet / topup paths read
   and write `Wallet.balance` atomically with the rest of the trade
   transaction.
2. Users can buy coin packs at `/wallet` → 4 tiers, instant credit,
   idempotent on a server-generated payment reference. The handler is
   shaped so wiring a real PG is a single-file change (verify the receipt
   instead of trusting the request).
3. `/api/internal/wallet` is live and gated behind the shared secret.
   Auctions + Aviator can already call it — they just don't yet.

## Razorpay top-up flow (Phase 0.5)

Strict 1₹ → 1 coin. Three routes + the Razorpay JS SDK:

```
client                    /api/wallet/topup/order   →   Razorpay API
  │                                                       creates orderId
  ◄─── { orderId, razorpayKeyId, amountInPaise } ────────┘
  │
  Razorpay Checkout opens with orderId
  user pays
  Razorpay returns { razorpay_payment_id, razorpay_signature }
  │
  ▼
                          /api/wallet/topup/verify
                            verifyPaymentSignature(HMAC SHA-256)
                            credit Wallet + write Transaction
                                  (kind="wallet_topup",
                                   reference="razorpay:<paymentId>")
                            flip PaymentOrder → CAPTURED
                            publish wallet SSE
                          ←── { ok, balance, credited }
```

In parallel, Razorpay calls `POST /api/webhooks/razorpay` with the
`payment.captured` event. That route also verifies the HMAC (different
secret: `RAZORPAY_WEBHOOK_SECRET`), idempotent-credits via the same
`(kind, reference)`, and ack-200's any other event type. So:

- Happy path: client `/verify` fires first, credits, webhook arrives later
  and short-circuits via `P2002`.
- Browser closes mid-checkout: webhook still credits.
- Network drops both: Razorpay retries the webhook for 24 hours.

### Required env

```
RAZORPAY_KEY_ID=rzp_live_xxx
RAZORPAY_KEY_SECRET=xxx
RAZORPAY_WEBHOOK_SECRET=xxx  # configured in Razorpay dashboard → Webhooks
```

If `RAZORPAY_KEY_ID` is unset, `/api/wallet/topup/order` returns 503 and
the client UI shows "Payments aren't configured". A dev escape hatch
`ALLOW_INSTANT_TOPUP=true` lets `/api/wallet/topup` credit instantly
without Razorpay — strictly for local dev. Production must never set
that flag.

## Withdrawal flow

```
user                                                       admin
 │                                                            │
 │  POST /api/wallet/withdraw                                 │
 │  { payoutMethod: UPI|BANK, amountCoins, ...payoutDetails } │
 │   ↳ Wallet debit (LOCKS coins)                             │
 │   ↳ WithdrawalRequest (PENDING)                            │
 │   ↳ Transaction (kind="withdrawal_lock")                   │
 │   ↳ records ipAddress + userAgent                          │
 │                                                            │
 │  GET  /api/wallet/withdraw                                 │
 │  DELETE /api/wallet/withdraw/[id]   (cancel while PENDING) │
 │   ↳ refund via Transaction (kind="withdrawal_refund")      │
 │                                                            │
 │                            POST /api/admin/withdrawals/[id]│
 │                                  action=approve            │
 │                                    PENDING → APPROVED      │
 │                                  action=reject             │
 │                                    PENDING → REJECTED      │
 │                                    + refund credit          │
 │                                  action=mark_paid           │
 │                                    APPROVED → PAID         │
 │                                    + Razorpay payout id    │
 │                                                            │
 │                            All actions audited to AdminLog │
 │                            User receives a Notification    │
```

### Admin malpractice review

`/admin/users/[id]/audit` aggregates everything wallet-affecting on one
page so a moderator can verify a withdrawal request before approving:

- Wallet balance + flags (banned, emailVerified, signup date)
- Transaction breakdown by `kind` ("+50,000 wallet_topup, +18,000
  resolution_payout, -65,000 trade_buy")
- Last 40 ledger rows
- Last 20 trades with market title + price-per-share
- Open positions with mark-to-market P/L vs cost basis
- Full withdrawal history with IP + status
- **IP overlap warning** — if the user has withdrawn from an IP that any
  other account has also withdrawn from, surface those accounts with a
  link to each one's audit page

The "Audit this user →" link sits next to every row in
`/admin/withdrawals`, so the moderator's flow is: see the queue → click
audit → verify the source of every coin → return and approve/reject.

### Withdrawal rate limits + guards

| Guard | Threshold | Reason |
|---|---|---|
| `MIN_WITHDRAW_COINS` | 100 coins (₹100) | Keep the admin queue from drowning in ₹1 requests |
| Per-user rate limit | 3 per hour | Anti-abuse — also rate-limits accidental double-submits |
| `email_not_verified` block | Hard 403 | Spam accounts can't request payouts |
| `banned` block | Hard 403 | Banned users can't drain a fraud-flagged wallet |
| Locked coins on submit | Atomic with the request row | A user can't double-spend the same coins on a market while withdrawal is pending |
| Server-controlled state machine | PENDING → APPROVED|REJECTED; APPROVED → PAID | A modded admin client can't skip approve, jump straight to paid without an admin's click |

## What's left (Phase 1: auctions backend)

The auctions backend (`backend/`, NestJS on `:4000`) currently keeps its
own `User.coinBalance` column and writes to it directly from
`BidsService.placeBid`, the auction-close scheduler, etc.

To switch it to the unified wallet:

1. **Identity bridge.** Decide how a NestJS-side user maps to a Bet-side
   user. Cleanest option: add a nullable `betUserId` column on `User` in
   the backend, populated on signup by calling Bet's register API (or by
   email-matching for existing users in a one-time backfill).
2. **Replace `BidsService.placeBid`'s direct decrement** with an HTTP
   call to `POST /api/internal/wallet { op:"debit", userId: betUserId,
   amount: auction.coinsPerBid, kind:"auction_bid", reference:"bid:"+bidId }`.
   The bid insert and the wallet debit are no longer in the same Postgres
   transaction — wrap them in a saga: if the wallet call fails, abort the
   bid. If the bid insert fails after a successful debit, issue a
   compensating credit with the same reference + `:rollback` suffix.
3. **Auction close (`AuctionsService.close` / scheduler)** — issue a
   `credit` for the winner with `kind:"auction_win"`, `reference:"win:" +
   auctionId + ":" + userId`. Lock auctions can also issue refunds via
   `kind:"auction_refund"` when cancelled.
4. **Drop `User.coinBalance` from the schema** once all writers are gone.
   Keep it nullable during a transition window so a rolling deploy can't
   read a stale column.

## What's left (Phase 2: Aviator)

Aviator currently uses `User.walletBalance`, which is **INR** (rupees), not
coins. Two routes here:

- **Convert Aviator to coins.** The cleanest end-state. Existing INR
  balances get a one-time migration at the current `inrPerCoin` rate, and
  the Aviator service starts calling the same `/api/internal/wallet`
  endpoints with `kind:"aviator_stake"` and `kind:"aviator_cashout"`.
- **Run a translation layer.** If Aviator must keep INR semantics
  internally (e.g. for withdrawal-via-Razorpay flows), keep its own
  `walletBalance` but mirror every change to Bet's coin wallet via an
  inrPerCoin division. More moving parts but doesn't require touching the
  Aviator game logic.

Recommendation: do the conversion. The withdrawal flow can still go
through the auctions backend's Razorpay code path — debit Bet's coin
wallet, then issue a Razorpay payout of `coins / inrPerCoin` rupees.

## Operational notes

- Set `INTERNAL_API_SECRET` to a high-entropy random string in production
  (`openssl rand -base64 32`) and make sure the auctions backend +
  Aviator both have it as env. Leaking it = ability to credit/debit any
  user's wallet, so treat it like a DB password.
- `/api/internal/wallet` should NOT be exposed to the public internet in
  production. Bind it to a VPC-internal load balancer or firewall by IP
  to the known callers.
- The endpoint publishes a `{type:"wallet"}` event to the user's SSE
  channel on every successful change, so the in-app wallet UI re-fetches
  immediately. Other apps don't need to do anything for that to work.
- Postgres transaction isolation: every wallet op runs in its own
  `db.$transaction` with `READ COMMITTED` (Prisma default), and uses
  per-user `wallet.update` which acquires a row lock implicitly. No
  serialisation anomalies even under heavy concurrent traffic.
