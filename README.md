# Kalki Bet

A monorepo for the Kalki Bet platform:

- **`backend/`** — NestJS API (auctions, bidding engine, wallet, aviator
  crash engine, KYC, notifications, payments)
- **`bet/`** — Next.js 15 prediction-market app
- **`auctions/`** — Next.js 15 auctions hub / SSO landing
- **`aviator/`** — Next.js 15 crash game
- **`admin/`** — Vite + React operator dashboard
- **`app/`** — Android app (Jetpack Compose, min SDK 26)
- **`ios/`** — iOS app

## Run the entire backend + web stack — one command

The whole platform (postgres, redis, all 5 services, reverse proxy,
mailpit, adminer) runs in Docker. Host requirements: **Docker** and
**Docker Compose v2**. Nothing else.

```bash
git clone https://github.com/mahakaal02/bet.git
cd bet
cp .env.example .env
docker compose up -d --build
# wait ~3-5 min on first run, ~30s subsequently
```

Then open:

- <http://localhost:8000> — unified proxy
- <http://localhost:8000/admin/> — operator SPA (admin@kalki.local / password12345 after `make -f Makefile.dev seed`)
- <http://localhost:8080> — Adminer (Postgres GUI)
- <http://localhost:8025> — Mailpit (captured outbound mail)

Full setup, troubleshooting, architecture diagram, hot-reload notes,
database operations, and rebuild instructions live in **[DOCKER.md](DOCKER.md)**.

Convenience wrappers (all do the same thing):

```bash
make -f Makefile.dev up         # Linux / macOS / WSL
.\scripts\dev.ps1 up            # Windows PowerShell
./scripts/dev.sh up             # POSIX
```

### Android / iOS

Not Docker-driven — open `app/` in Android Studio or `ios/` in Xcode.
The Android emulator's `10.0.2.2` resolves to the host, so debug builds
hit the backend running in Docker. Sign in as
`user1@kalki.local` / `password12345` after running the seed.

## What's new

### Slice 3 — Admin dashboard

- React 18 + Vite 6 + Tailwind v4 (no config file — `@import "tailwindcss"`
  + custom brand colors in `src/styles.css`)
- Pages: Login, Auctions (list + close-now), New auction, Coin economy
- Uses the existing `/admin/*` REST endpoints; admin gate is enforced both
  in the UI (`AdminUser.isAdmin`) and in the backend (`AdminGuard`)
- Dev server proxies `/api` to the backend so CORS isn't an issue locally

### Slice 5 — Polish

**Rate limiting** — `@nestjs/throttler` with a global 60 req/min and a tight
5 req/10s ceiling on `POST /auctions/:id/bids` to make bot-flooding
expensive even before requests reach the DB.

**Auction auto-close scheduler** — `@nestjs/schedule` cron runs every minute,
finds LIVE auctions with `endsAt` in the past, and closes them under a
Redis advisory lock (safe for horizontal scaling).

**FCM-ready notifications** — `NotificationsService` boots Firebase Admin
if `FIREBASE_CREDENTIALS_PATH` is set, otherwise logs notifications instead
of sending. Device tokens register via `POST /devices`. The scheduler
already fires a "you won!" push at close time.

**Android WebSocket auto-reconnect** — exponential backoff (1s → 30s).
`lastCandidate` is cached and re-submitted on reconnect so the status
stream resumes seamlessly. Clean client-initiated closes (code 1000) do
NOT trigger reconnect.

### Slice 4 — Razorpay coin purchases

End-to-end flow:

1. Wallet screen loads coin packs from `GET /coin-packs`.
2. Tap **Buy** → Android calls `POST /payments/coin-pack/:id/order` →
   backend creates a Razorpay Order (returns `orderId`, `keyId`, amount).
3. Android opens `Checkout.open(activity, options)`; user pays.
4. Razorpay returns `payment_id`, `order_id`, `signature` to the Activity.
   `MainActivity` (implements `PaymentResultWithDataListener`) emits to a
   `RazorpayBus` that `WalletViewModel` subscribes to.
5. Android calls `POST /payments/verify`. Backend HMAC-verifies the
   signature against `RAZORPAY_KEY_SECRET`, atomically credits coins, and
   writes a `CoinTransaction` audit row. Idempotent on `(reason,
   reference)` so duplicate verify calls are safe.

Schema additions: `CoinPack`, `PaymentOrder` (PENDING → CAPTURED),
`CoinTransaction` (positive credit / negative debit with reason +
reference, unique-indexed for idempotency).

**Play Billing** scaffold lives at
`app/src/main/java/com/uniquebid/app/data/billing/BillingManager.kt`.
Connection and listener are wired; product launch is a TODO that needs
Play Console SKUs and a backend service-account key.

To enable Razorpay:

1. Get test keys at <https://dashboard.razorpay.com/>.
2. Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `backend/.env`.
3. Restart the backend. Without keys, the payment endpoints return 503.

## To enable real FCM

1. Create a Firebase project, enable Cloud Messaging.
2. Download a service-account JSON, place it on the backend host, point
   `FIREBASE_CREDENTIALS_PATH` at it in `.env`.
3. (Android side, deferred slice) Add `google-services.json` to `app/`,
   apply the `com.google.gms.google-services` plugin, add a
   `FirebaseMessagingService`, POST the device token to `/devices`.

The backend pipeline is complete — only the Android FCM client is left.

## What's still missing

- **Play Billing end-to-end** — Android receiver implemented, backend
  validation endpoint and Play Console SKUs still needed.
- **Android FCM receiver** — backend dispatch is done; Android needs
  `google-services.json` + the GMS plugin + a `FirebaseMessagingService`.
- **Razorpay webhooks** — current flow relies on the client-driven verify
  endpoint. Adding webhook handling on `payment.captured` makes the
  pipeline robust to client crashes mid-purchase.
- **Encrypted token store**, signed-release config, network-security
  config that disables cleartext in release builds.
- Per-auction bid moderation in admin (no UI to inspect raw bids).
- Audit log of admin changes.
