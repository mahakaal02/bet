# UniqueBid

Slices 1–5 are in. The system has:

- a NestJS backend with the lowest-unique-bid engine, rate limiting, an
  auto-close scheduler, FCM-ready notifications, and Razorpay coin purchases
- a Jetpack Compose Android app with auto-reconnecting WebSocket bid status
  and end-to-end Razorpay Checkout integration
- a Vite + React admin dashboard for coin economy, auction CRUD, and coin
  pack CRUD

## Layout

- `app/` — Android app (Jetpack Compose, min SDK 26)
- `backend/` — NestJS API
- `admin/` — Vite + React admin dashboard

## Run it end-to-end

### Backend

```bash
cd backend
cp .env.example .env
npm install
docker compose up -d                       # Postgres + Redis
npx prisma migrate dev --name slice5       # picks up DeviceToken model
npm run prisma:seed
npm test                                   # bidding-engine unit tests
npm run start:dev                          # :4000
```

### Admin dashboard

```bash
cd admin
npm install
npm run dev                                # :5173, proxies /api → :4000
```

Open <http://localhost:5173>, sign in as `admin@uniquebid.local` / `admin123`,
create auctions, tune coin economy.

### Android app

Open `First App/` in Android Studio. Run on the emulator (debug build points
at `10.0.2.2:4000`). Sign in as `demo1@uniquebid.local` / `demo1234`.

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
