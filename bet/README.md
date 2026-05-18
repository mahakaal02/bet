# Kalki Exchange — Prediction Markets

A Kalshi/Polymarket-style prediction market app. Trade YES/NO on real-world
events with **the unified Kalki Bet wallet** — the same coin balance that
powers Live Auctions and Aviator.

Built as a sibling to the UniqueBid / Aviator apps in this monorepo and
embedded in the Android app behind the **"Bet"** hub card via WebView. The
wallet schema in this app is the **canonical source of truth** for every
game on the platform — see [`UNIFIED_WALLET.md`](../UNIFIED_WALLET.md) for
the architecture, API contract, and migration plan for the other two apps.

## Stack

- **Next.js 15** (App Router) + React 19 + TypeScript
- **Tailwind 4** + shadcn-flavoured primitives
- **Prisma** + Postgres
- **NextAuth** — Credentials (email/password) + Google OAuth (optional)
- **Recharts** for the price chart, **SWR** for live polling
- **Zod** for input validation; in-memory rate limiter (swap for Redis in prod)
- Constant-product **AMM** for binary outcomes — no orderbook matching yet

## Local quickstart

```bash
cd bet
cp .env.example .env

# Use the host Postgres (the monorepo runs one on :5432). Create a fresh DB:
psql -h localhost -U postgres -c "CREATE DATABASE bet;"

npm install
npx prisma migrate dev   # runs all migrations
npm run prisma:seed
npm run dev
```

### Where to open it

`next dev -p 3100` binds to all interfaces, so you have **three working URLs**:

| URL | Where it works |
|---|---|
| `http://localhost:3100` | Host machine browser |
| `http://127.0.0.1:3100` | Host machine browser |
| `http://10.0.2.2:3100`  | **Inside the Android emulator** (loopback to the host) |
| `http://<your-LAN-IP>:3100` | Phones / tablets on the same Wi-Fi (run `ipconfig getifaddr en0` on macOS to find the IP) |

The Android app's WebView is wired to `BET_URL` in `app/build.gradle.kts`
(debug: `http://10.0.2.2:3100/`).

Seeded admin: `admin@kalki.local` / `password12345` · Demos: `user1@kalki.local` … `user3@kalki.local` / `password12345`.

## How to use

1. **Sign up** — 10,000 demo coins land in your wallet instantly.
2. **Browse `/markets`** — filter by category, sort by trending/volume/ending soon.
3. **Open a market** — pick YES or NO, enter coins, confirm. Price updates live
   for everyone watching (SWR poll every 2.5s).
4. **`/portfolio`** — mark-to-market valuation of your open positions.
5. **`/leaderboard`** — top traders by XP.
6. **`/profile`** — claim the daily faucet (+500 coins, streak bonus every 7th day).
7. **`/admin`** (admin only) — create markets, edit, resolve YES/NO/CANCELLED,
   adjust user balances, ban/unban.

## Trading model — AMM (Polymarket-style CPMM)

Each market starts with `yesShares = noShares = 1000` (50/50). Buying YES
with `C` coins uses the **split-coin** model:

1.  Take in `C` coins, subtract 1% fee → `c`.
2.  Each coin can be split at par into 1 YES + 1 NO share. The market mints
    `c` YES + `c` NO from your `c` coins.
3.  Deposit the `c` NO into the pool. To preserve `k = yes * no`, the pool
    returns `yes - k/(no+c)` YES shares to you.
4.  **You walk away with `c + (yes − k/(no+c))` YES shares** — your own
    split's YES plus the pool's transfer.

The marginal price is `priceYes = noShares / (yesShares + noShares)`. Your
realized **average price** is `cost / sharesOut`, which is always in the
range **(marginal_before, 1)**:

- Tiny trades → avg ≈ marginal (no slippage).
- Larger trades → avg drifts toward 1 as each coin pushes the price up.

On resolution every winning share pays exactly 1 coin, so your max payout
when YES wins is `floor(sharesOut)` coins.

### Worked example

Pool at 50/50, buying 1000 YES:

| Quantity | Value |
|---|---|
| Coins spent | 1000 |
| Shares received | ~1487 |
| Average price | ~0.67 |
| Marginal price after | ~0.80 |
| Payout if YES wins | 1487 coins (+487 profit) |

Earlier versions of [lib/amm.ts](lib/amm.ts) omitted step 4's first term
(only crediting the pool transfer), which produced impossible average
prices > 1.0 — buying 1000 coins gave only ~488 shares. The corrected
math is verified by [scripts/amm-sanity.ts](scripts/amm-sanity.ts), and
[scripts/backfill-amm-bug.ts](scripts/backfill-amm-bug.ts) retroactively
credits the missing `c` shares to every Position that was affected before
the fix (idempotent, runs once or many times — duplicate runs no-op
because of the unique `(kind, reference)` constraint on `Transaction`).

Run the backfill after pulling the fix:

```bash
npx tsx scripts/backfill-amm-bug.ts --dry   # preview
npx tsx scripts/backfill-amm-bug.ts         # apply
```

Each corrected user gets a notification explaining the change.

For users who want exact-quantity buying without AMM slippage, the
[orderbook](#orderbook-clob) gives `shares × limitPrice` coin pricing.

## Project structure

```
bet/
├── app/
│   ├── (api)/                  # NextAuth route handler
│   ├── admin/                  # Admin panel (gated server-side)
│   ├── api/
│   │   ├── admin/              # Admin-only mutations (market CRUD, resolve, user mgmt)
│   │   ├── markets/[slug]/state/   # Live AMM state (polled by trade panel)
│   │   ├── markets/[id]/comments/  # Comments thread
│   │   ├── me/                 # Authed user + wallet snapshot
│   │   ├── register/           # Email/password signup
│   │   ├── rewards/claim/      # Daily faucet
│   │   ├── trade/              # Buy YES/NO (atomic)
│   │   └── watchlist/          # Star/unstar markets
│   ├── leaderboard/
│   ├── markets/[slug]/         # Market detail (chart, trade panel, comments)
│   ├── portfolio/
│   ├── profile/                # Wallet, streak, referral code, watchlist, activity
│   ├── login/
│   ├── register/
│   ├── layout.tsx              # Disclaimer bar + Toaster + SessionProvider
│   └── page.tsx                # Landing
├── components/
│   ├── ui/                     # Button, Card, Input, Badge, Toaster
│   ├── Navbar.tsx              # Sticky top nav with live coin chip
│   ├── DisclaimerBar.tsx       # Always-on "demo only" strip
│   ├── TokenBridge.tsx         # Strips ?token=… from Android WebView
│   ├── MarketTradePanel.tsx    # YES/NO buy panel with live quote
│   ├── PriceChart.tsx          # Recharts line chart
│   ├── MarketForm.tsx          # Admin create/edit form
│   ├── ResolveMarketPanel.tsx  # Admin resolve YES/NO/CANCELLED
│   └── UserAdminPanel.tsx      # Admin user actions
├── lib/
│   ├── auth.ts                 # NextAuth config + getAuthedUser helper
│   ├── db.ts                   # Prisma client (HMR-safe)
│   ├── amm.ts                  # Constant-product math
│   ├── coins.ts                # Env-driven constants
│   ├── rate-limit.ts           # In-mem sliding window
│   └── utils.ts                # cn(), fmtCoins, fmtPct, timeAgo, levelFromXp
├── prisma/
│   ├── schema.prisma           # 10 models (User, Wallet, Market, Trade, Position, …)
│   └── seed.ts                 # admin + 5 demos + 11 markets across categories
├── types/next-auth.d.ts        # Augments Session/JWT with username + isAdmin
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## Android integration

The Android app's Hub now shows three cards: **Live Auctions / Aviator / Bet**.
Tapping Bet opens a `WebView` on `BET_URL` (debug: `http://10.0.2.2:3100/`,
configurable in `app/build.gradle.kts`). The Bet JWT identity is separate from
the UniqueBid identity — first visit shows the login/register screen.

Files added on the Android side:

- `app/src/main/java/com/uniquebid/app/ui/screens/bet/BetScreen.kt`
- `app/src/main/java/com/uniquebid/app/ui/screens/bet/BetViewModel.kt`
- `Routes.Bet` + nav graph entry
- `BET_URL` build config field

## Security notes

- Email/password hashes via bcryptjs (10 rounds).
- Session strategy: JWT (`maxAge` 30d). NextAuth signs the cookie with `NEXTAUTH_SECRET`.
- Every admin route checks `isAdmin` on the session (`getAuthedUser()`); the
  app-router middleware can also be added later for a defence-in-depth deny.
- All mutating routes Zod-validate input.
- Rate limit: register (5/min/IP), trade (10/10s/user), comment (5/30s/user).
- `Market` rows lock in `db.$transaction` during a trade so concurrent buys
  on the same market serialise.
- Daily faucet is idempotent on `(kind="daily_claim", reference="daily:<userId>:<YYYY-MM-DD>")`.

## Realtime stack

The trade panel and notifications bell are driven by **Server-Sent Events**
(`/api/markets/{id}/stream` and `/api/me/stream`) — no polling, no custom
server, just streaming responses from a Next.js route handler. Channels go
through `lib/pubsub.ts`, which uses an in-process `EventEmitter` by default
and transparently swaps to **Redis pub/sub** when `REDIS_URL` is set (needed
once the app runs on multiple instances behind a load balancer).

Publishing happens **after** the Prisma `$transaction` commits, so a rolled-
back trade never leaks a phantom price tick to subscribers.

## Achievements

Trigger-driven (not nightly cron). `lib/achievements.ts` is called inline
from the trade / resolve / claim / watchlist / register paths and awards
badges atomically. Catalog lives in `Achievement` rows (seeded), unlocks in
`UserAchievement`. Reward coins and XP are applied in the same transaction.

When an achievement unlocks, the user's SSE stream pushes
`{type: "achievement_unlocked", ...}` which the **NotificationsBell** picks
up and surfaces as a toast, while the **AchievementsGrid** on `/profile`
revalidates.

Default catalog: `first_trade`, `ten_trades`, `hundred_trades`, `first_win`,
`profitable`, `streak_7`, `watch_5`, `referrer`, `diversified`, `whale`.

## Email verification

Self-serve dev-mode flow.

- `POST /api/auth/verify/request` → generates a 32-byte token, stores its
  SHA-256 hash, calls `sendEmail()`.
- `sendEmail()` uses **nodemailer + `SMTP_URL`** in production; in dev it
  logs the verification link to the server console so you can click-through
  without a mail server.
- `POST /api/auth/verify` consumes the token (single-use, 24h TTL) and
  flips `User.emailVerified`.

UI: an amber banner on `/profile` for unverified users with a "Send link"
button.

## Orderbook (CLOB)

Each market runs a full limit-order book **alongside** the AMM market-buy
button. The AMM provides instant liquidity for casual users; advanced
traders place limit orders that match against the book first and rest if
they don't cross.

### How it works

- **Place** (`POST /api/orders`) — body: `{marketId, outcome, side, limitPrice, shares}`.
  - BUYs lock `ceil(shares × limitPrice)` coins from the wallet.
  - SELLs lock `shares` of the matching `Position` (you can't sell what you
    don't have — `Position.shares - Position.locked` is the available cap).
  - The matcher walks resting opposite-side orders (best price first,
    time tie-break), creates `OrderMatch` + `Trade` rows for each fill,
    settles wallets + positions atomically.
  - **Price improvement** flows to the taker: if your BUY @ 0.60 matches
    a SELL @ 0.55, you pay 0.55 and get the 0.05 difference refunded.
  - Unfilled remainder rests on the book as a maker order.
  - **Self-trade prevention**: your own resting orders are skipped — you
    can't wash-trade your P/L.
- **Cancel** (`DELETE /api/orders/:id`) — refunds the unfilled locked coins
  (BUY) or releases the locked shares (SELL). Idempotent.
- **Read** (`GET /api/markets/:id/orderbook`) — returns aggregated bid/ask
  ladders for both YES and NO sides.
- **Live updates** — every place/cancel/fill publishes a `book` event on
  the market's SSE channel; the `OrderBookLadder` revalidates within
  milliseconds across all viewers.

The engine itself is a pure function in [lib/orderbook.ts](lib/orderbook.ts)
(`matchIncoming`, `buildLadder`, `snapPrice`) — no DB access, easy to
unit-test. The route handler in [app/api/orders/route.ts](app/api/orders/route.ts)
wraps it in a single Postgres transaction so partial fills, position
updates, wallet movements, and the rest-on-book remainder are all-or-nothing.

## Password reset

- `POST /api/auth/password-reset/request` `{ email }` — always returns 200
  (no account enumeration). If the email exists, emails a single-use 1-hour
  token. Rate-limited per IP.
- `POST /api/auth/password-reset` `{ token, password }` — hashes + sets the
  new password, consumes the token, invalidates any other outstanding
  reset tokens for that user.
- UI: `/forgot` and `/reset?token=…` pages, plus "Forgot password?" link on
  the sign-in form.
- In dev the reset link is logged to the Next.js console (same email
  transport as verification — set `SMTP_URL` in production).

## Production-tier rate limiter

`lib/rate-limit.ts` ships two backends behind one synchronous API:

- **In-memory** (default) — `Map<key, {count, resetAt}>` plus a 60s sliding
  window. Single-instance safe via `globalThis` HMR cache.
- **Redis** — fire-and-forget `INCR` + `PEXPIRE NX` pipeline. Activated
  when `REDIS_URL` is set; reconciles the local mirror counter on every
  Redis ack. Cross-instance consistent without making every request pay an
  awaited Redis round-trip.

To switch on:

```bash
export REDIS_URL=redis://localhost:6379
npm run dev
```

You'll see `rate-limit: using Redis at redis://localhost:***@…` in the
server log. Same env var is shared with `lib/pubsub.ts`, so SSE fan-out
upgrades to Redis pub/sub at the same time.

## Still on the roadmap

- **Email password-reset polish.** The flow is wired but auto-signin after
  reset isn't — currently bounces to `/login`. Could mint a fresh
  NextAuth session in the same response.
- **Order modify / replace.** Cancel-and-replace is two round-trips today;
  a single atomic replace would be friendlier for fast traders.
- **Cross-outcome AMM ↔ orderbook hybrid.** Today the two are parallel
  surfaces. Routing a taker order into whichever has better effective
  price (book best vs. AMM quote) is a clean extension.

## Disclaimer

This is a simulation platform for demonstration and education. There are no
payment gateways, deposits, withdrawals, or real-money flows of any kind.
Virtual coins have no monetary value and cannot be exchanged for anything.
