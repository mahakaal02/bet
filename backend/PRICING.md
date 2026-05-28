# PPP Regional Pricing

Steam/Netflix-style purchasing-power-parity pricing for the Kalki coin
economy. Coins are a **global** virtual currency — gameplay values
(entry fees, rewards, skins) are identical everywhere. Only the **fiat
price to buy a coin pack** varies by country, so a player in India pays
a locally-fair price (₹39) for the same 100 coins a US player buys for
$0.99.

> **Business rules baked in**
> - Gameplay economy is global; never localized.
> - Fiat purchase prices are localized by affordability.
> - Prices are **stable** — synced once a year, never daily/monthly.
> - We never expose direct fiat equivalence ("1 coin = ₹1") on the
>   public API. The derivation columns (forex, multiplier, base USD)
>   are admin-only.

---

## The model

```
local_price = base_usd_price × purchasing_power_multiplier × exchange_rate
            → then country-specific psychological rounding
```

Worked example (the spec's):

```
base_usd_price            = $0.99
USD→INR exchange_rate      = 83
India PPP multiplier       = 0.40
calculated                 = 0.99 × 0.40 × 83 = ₹32.87
rounded (charm-9 whole)    = ₹39
```

---

## Architecture (clean / layered)

```
                       ┌─────────────────────────┐
  GET /pricing/current │   PricingController     │  public, unauthenticated
                       └────────────┬────────────┘
                                    │ resolve country (server-side)
                       ┌────────────▼────────────┐
                       │ CountryDetectionService │  billing > geo > AL > IP
                       └────────────┬────────────┘
                                    │
  POST /admin/pricing/* ┌───────────▼────────────┐  @Perm(pricing.view|sync)
  (PricingAdminController│     PricingService     │  orchestration: sync,
                        │  (I/O: DB, Redis, HTTP) │  read, cache, fallback
                        └───┬─────────┬────────┬──┘
                            │         │        │
              ┌─────────────▼─┐ ┌─────▼────┐ ┌─▼──────────────┐
              │ PricingEngine │ │ Forex    │ │ Ppp            │
              │ (pure math:   │ │ Provider │ │ Provider       │
              │  normalize +  │ │ exchange │ │ World Bank     │
              │  price + round)│ │rate.host│ │ GDP/cap PPP    │
              └───────────────┘ └──────────┘ └────────────────┘
                    │
              ┌─────▼──────────────┐
              │ regional-rounding  │  roundPriceForRegion(country, value)
              │ app-store-mapping  │  suggestStoreTier(value, fractionDigits)
              └────────────────────┘
```

Each layer is independently testable. The engine, rounding, and country
detection are **pure** (no I/O) — unit-tested in
`*.spec.ts`. Providers depend on an **abstract** base class, bound to
concrete impls in `pricing.module.ts`, so swapping exchangerate.host →
ECB or World Bank → IMF is a one-line change.

### Files

| File | Responsibility |
|------|----------------|
| `pricing.config.ts` | Country catalog (country→currency→rounding), baseline, clamp band, fallback map |
| `regional-rounding.ts` | `roundPriceForRegion()` — per-currency psychological rounding |
| `providers/forex.provider.ts` | `ForexProvider` + `ExchangeRateHostProvider` |
| `providers/ppp.provider.ts` | `PppProvider` + `WorldBankPppProvider` |
| `pricing-engine.service.ts` | `normalizeMultipliers()`, `priceRow()` — pure math |
| `country-detection.service.ts` | Server-side region resolution + fallback |
| `app-store-mapping.ts` | `suggestStoreTier()` — Apple/Google price-point hints |
| `pricing.service.ts` | `runAnnualPricingSync()`, `getCurrentPricing()`, admin CRUD |
| `pricing.scheduler.ts` | `@Cron('5 0 1 4 *')` annual run (Apr 1 00:05 UTC) |
| `pricing.controller.ts` | `GET /pricing/current` |
| `pricing-admin.controller.ts` | `POST/PATCH /admin/pricing/*` |

---

## Database

| Table | Purpose |
|-------|---------|
| `CoinPack` (extended) | `baseUsdPrice` (USD anchor) + `sku` added; `priceInr` kept for the legacy Razorpay path |
| `PricingSnapshot` | One yearly run. Exactly one `PUBLISHED` at a time. |
| `ForexRateSnapshot` | Frozen USD→currency rates for the year |
| `PppFactorSnapshot` | Normalized affordability multiplier per country (+ raw value, fallback flag) |
| `RegionalCoinPricing` | The final per-country, per-pack fiat price + full derivation (matches the spec's `regional_coin_pricing` columns 1:1) |

`@@unique([effectiveYear])` on `PricingSnapshot` makes the sync
**idempotent** — re-running a year replaces that year's snapshot inside
one transaction. `@@unique([snapshotId, coinPackId, countryCode])` on
the rows prevents duplicates.

---

## Annual sync

```
runAnnualPricingSync({ year?, publish?, generatedBy? })
```

Flow (all inside a Redis advisory lock so cron + manual can't race):

1. Load active coin packs that have a `baseUsdPrice`.
2. Fetch forex (exchangerate.host) — **retry** 3× with backoff.
3. Fetch PPP / GDP-per-capita-PPP (World Bank) — retry 3×.
4. Normalize multipliers vs the baseline (US = 1.0), clamp to
   `[0.25, 1.25]`, flag fallbacks.
5. Compute `pack × country` prices, apply rounding.
6. Persist snapshot + forex + ppp + rows in **one transaction**.
7. On publish: deactivate the previous snapshot, activate this one.
8. Bust the Redis price cache.

**Idempotent + retry-safe**: a crash mid-run leaves the previous
published pricing untouched; a re-run for the same year converges.

Triggers:
- **Cron** — Apr 1 00:05 UTC (`pricing.scheduler.ts`), publishes.
- **Manual** — `POST /admin/pricing/sync` (`{publish:false}` stages a
  DRAFT for review; publish later via
  `POST /admin/pricing/snapshots/:id/publish`).

---

## API

### `GET /pricing/current`

Public. Resolves the caller's country server-side and returns the
localized pack list:

```jsonc
{
  "effectiveYear": 2026,
  "country": "IN",
  "currency": "INR",
  "source": "geo-header",
  "usedFallback": false,
  "packs": [
    { "coinPackId": "pack-50",  "coins": 50,  "sku": "coins_50",  "currency": "INR", "price": "39" },
    { "coinPackId": "pack-120", "coins": 120, "sku": "coins_120", "currency": "INR", "price": "79" }
  ]
}
```

Note: forex rate / multiplier / base-USD are **not** in this payload by
design (no fiat-equivalence exposure).

### Admin (`@Perm('pricing.view' | 'pricing.sync')`)

| Method | Path | Perm |
|--------|------|------|
| GET | `/admin/pricing/snapshots` | view |
| GET | `/admin/pricing/snapshots/:id` | view |
| POST | `/admin/pricing/sync` | sync |
| POST | `/admin/pricing/snapshots/:id/publish` | sync |
| PATCH | `/admin/pricing/rows/:id` | sync |
| PATCH | `/admin/pricing/ppp/:id` | sync |

Granted to `ADMIN` (via `*`), `FINANCE`, and `pricing.view` to
`AUDITOR` (via `*.view`). Every mutation writes an `AdminAuditLog` row.

---

## Country detection & anti-abuse

Trust order (highest → lowest):

1. **Verified billing country** (validated store receipt) — the only
   signal we'd lock a purchase to.
2. Saved profile billing country.
3. Edge geo header (`cf-ipcountry` / `x-vercel-ip-country`).
4. `Accept-Language`.
5. Raw socket IP (**treated as possibly-VPN — lowest trust**).

Anti-arbitrage (see also the app's purchase flow):

- The **price region is resolved server-side** — a `?country=` query is
  only the lowest-trust hint and never overrides a billing region.
- The **charge** is validated against the store receipt's region at
  purchase time (Apple/Google enforce the storefront).
- Coins are **non-transferable across regions**; gifting and
  cross-region coin transfers are blocked (enforced in the
  wallet/transfer layer, out of scope for this module but documented
  as a hard requirement).

Fallback chain when a country isn't priced directly:
`exact catalog hit → NEAREST_REGION_FALLBACK proxy → USD/US baseline`.

---

## Caching

`GET /pricing/current` is cached in Redis per-country (`pricing:current:<CC>`)
with a **7-day TTL** — prices change once a year, so the cache can be
very long-lived. A publish (cron or manual) busts the whole cache via
`SCAN`, so new pricing is visible immediately. CDN caching can layer on
top with the same long TTL.

---

## Configuration / env

| Env | Default | Purpose |
|-----|---------|---------|
| `OPEN_ER_API_URL` | `https://open.er-api.com/v6/latest/USD` | Default forex endpoint — **no key required**, covers all our currencies |
| `EXCHANGERATE_HOST_KEY` | — | Set to switch to exchangerate.host (the spec's "preferred" source). It now requires a paid access key; without this var we default to open.er-api.com. |
| `EXCHANGERATE_HOST_URL` | `https://api.exchangerate.host/live` | exchangerate.host endpoint (only used when the key is set) |
| `WORLDBANK_API_URL` | `https://api.worldbank.org/v2` | PPP endpoint (no key) |

**Forex provider selection** (`pricing.module.ts`): the `ForexProvider`
binding is a factory — `ExchangeRateHostProvider` when
`EXCHANGERATE_HOST_KEY` is set, otherwise `OpenErApiForexProvider`. One
env var, no code change. (exchangerate.host removed its free no-auth
tier, so open.er-api.com is the out-of-the-box default.)

Adding a market: append a row to `COUNTRY_CATALOG` in
`pricing.config.ts` (country, currency, fraction digits, rounding
strategy). The next sync picks it up — no other change needed.

---

## Tests

```
backend/src/pricing/regional-rounding.spec.ts   psychological rounding (spec examples)
backend/src/pricing/pricing-engine.spec.ts      normalization + price calc + clamps
backend/src/pricing/country-detection.spec.ts   trust order + fallback chain
```

Run: `docker compose exec backend npm test -- pricing` (or
`make -f Makefile.dev test`).

---

## Operational notes / logging

- A `PppFactorSnapshot.isFallback = true` row means the upstream had no
  datum (or the value was clamped) — surfaced with a ⚠ in the admin
  grid and in the sync log's `flagged=[…]` list. Review + override via
  `PATCH /admin/pricing/ppp/:id`.
- A failed cron run logs loudly and leaves the **previous** year's
  pricing active (never deactivated mid-failure). Re-run via the admin
  trigger.
