# bet i18n — engineering notes

Production-grade i18n + geo-based language detection for the Kalki
Exchange. Shipped as PR-BET-I18N.

## What's here

- **`config.ts`** — Locale list (`en | pt | es | fr`), country→locale
  map, cookie names. Single source of truth.
- **`translations/{en,pt,es,fr}.ts`** — Dictionary per locale. English
  is the canonical key set; the others are `Partial<Dictionary>` and
  fall back to English on missing keys.
- **`index.ts`** — Public API: `t(key, locale, vars?)`, `localizedPath`,
  `splitLocaleFromPath`, `alternatesFor`, `parseAcceptLanguage`,
  `isLikelyBot`. Universal-safe (server + client + edge).
- **`../../middleware.ts`** — Edge-runtime locale detection +
  redirect. See "Redirect flow" below.
- **`../../components/LanguageSwitcher.tsx`** — Client-side dropdown.
- **`../../app/[locale]/layout.tsx`** — Localized route layout with
  hreflang + canonical metadata.
- **`../../app/[locale]/page.tsx`** — Worked example for migrating
  pages into the locale tree.
- **`../../app/sitemap.ts`** — Per-locale sitemap with
  `alternates.languages` blocks.
- **`../../app/robots.ts`** — Crawl allow/disallow + sitemap pointer.

## Redirect flow

The resolution chain runs top-to-bottom; first match wins.

```
Request lands → middleware (edge)
  │
  ├─ /_next/* / /api/* / /admin/* / static asset?
  │     YES → pass through (matcher excludes these).
  │
  ├─ 1️⃣  EXPLICIT URL — path is /{locale}/...
  │     YES → pass through unchanged. No cookie writes.
  │
  ├─ Non-localized carve-out (/share, etc.)?
  │     YES → pass through.
  │
  ├─ User-Agent looks like a bot?
  │     YES → 302 → /{DEFAULT_LOCALE}{path}. No cookie writes.
  │
  ├─ 2️⃣  preferred_language COOKIE set?
  │     YES → 302 → /{cookie}{path}.       ★ MANUAL CHOICE WINS
  │
  ├─ 3️⃣  ACCEPT-LANGUAGE header yields a supported locale?
  │     YES → 302 → /{accept-language[0]}{path}.
  │              (Robust q-value parser handles q=0 rejections,
  │               region stripping fr-CA→fr, wildcards, ties.)
  │
  ├─ 4️⃣  GEO-IP from edge headers (only if sentinel NOT set)?
  │     YES → 302 → /{country→locale}{path}. Write sentinel.
  │
  └─ 5️⃣  DEFAULT_LOCALE → 302 → /{en}{path}.
```

### Why this order

| Step | Signal | Why it ranks here |
|---|---|---|
| 1 | Explicit URL | The user (or their inbound link) literally typed the locale. Highest signal possible. |
| 2 | Cookie | Set by the in-app language switcher — an explicit, persistent user choice. Beats any heuristic. |
| 3 | Accept-Language | The user's *own browser* configuration. Deterministic per-request, no network-position guesswork. A French traveller in Brazil still gets /fr/. |
| 4 | Geo-IP | Best-effort guess from network position. Used only when the user hasn't told us anything directly. |
| 5 | Default | Final fallback. |

### Key invariants

- **Manual choice always wins.** The `preferred_language` cookie is
  checked before any heuristic, set only by the language switcher.
- **Browser config beats geography.** Accept-Language now ranks
  *above* Geo-IP (per W3C best practice — the user's own browser
  setting is a more reliable signal than where their packets exit).
- **No repeated geo prompts.** The `kalki_geo_routed` sentinel
  flips to "1" the first time geo fires and stays 30 days. A user
  whose Accept-Language doesn't match any supported locale isn't
  re-geo-routed on every subsequent click.
- **No client-side JS redirects.** All locale routing happens at
  the edge before any HTML ships. Bots see the canonical URL on
  the first hit; users see their language without a flash.
- **302, not 301.** Geo state can change (VPN, travel), browser
  settings can change, and the user's preference can change.
  Caching as permanent would break language switching for any
  client behind a proxy that respects 301s.

### Accept-Language parser semantics

`parseAcceptLanguage()` in `index.ts` implements RFC 7231 §5.3.5:

- Parses `;q=…` weights (default 1.0, clamped to [0, 1]).
- Drops entries with `q=0` (RFC: "not acceptable").
- Strips region/script subtags — `fr-CA`, `fr_CA`, `fr-Latn-CA` all
  collapse to `fr`. Matches our 2-letter locale codes.
- Skips wildcard `*` (no signal — falls through to step 4/5).
- Stable sort: equal q-values preserve browser-supplied order so
  `fr-CA,en-US` (both default q=1) keeps `fr` first.
- Tolerates whitespace inside parameters (`fr ; q = 0.9`).
- Dedupes — first occurrence of a base language wins.
- Returns `[]` for null/undefined/empty/garbage headers.

Tested in `__tests__/i18n-accept-language.test.ts`.

## Migrating an existing page into `[locale]/`

The bet app's pre-i18n pages live at the root (`app/wallet/page.tsx`,
`app/markets/page.tsx`, etc.). They keep working — middleware
redirects bare `/wallet` to `/{locale}/wallet`, which 404s until
the page is moved.

Step-by-step:

1. **Move** the file: `app/wallet/page.tsx` → `app/[locale]/wallet/page.tsx`.
2. **Add the locale param** to the function signature:

   ```tsx
   export default async function WalletPage({
     params,
   }: {
     params: Promise<{ locale: string }>;
   }) {
     const { locale: raw } = await params;
     if (!isLocale(raw)) notFound();
     const locale: Locale = raw;
     // ...
   }
   ```

3. **Replace hardcoded strings** with `t('wallet.title', locale)` etc.
   Use the existing keys in `translations/en.ts`; add new ones as
   needed (then mirror them in the other three locale files —
   missing keys fall back to English so the deploy is non-breaking).
4. **Rewrite internal links** with `localizedPath`:

   ```tsx
   <Link href={localizedPath('/wallet/withdraw', locale)}>…</Link>
   ```

   Or pass `locale` into a shared `<Link>` wrapper.
5. **Add `generateMetadata`** so per-page hreflang URLs target the
   right sub-path (otherwise they all point at the locale root):

   ```tsx
   export async function generateMetadata({ params }): Promise<Metadata> {
     const { locale } = await params;
     const origin = process.env.NEXTAUTH_URL!;
     return {
       title: t('wallet.title', locale),
       alternates: {
         canonical: `${origin}/${locale}/wallet`,
         languages: alternatesFor(origin, '/wallet'),
       },
     };
   }
   ```

6. **Delete the original file** at `app/wallet/page.tsx`.

That's it — the move is mechanical. The translation infrastructure
guarantees the page works even if you only translate the most-
visible 80% of strings; the rest renders in English until they're
filled in.

## Adding a new locale

1. Add the code to `LOCALES` in `config.ts`.
2. Add a display name to `LOCALE_DISPLAY` (in the locale's own
   spelling — "Deutsch", not "German").
3. Add country codes to `COUNTRY_TO_LOCALE`.
4. Create `translations/<code>.ts` (start from `en.ts`, hand off to
   translators).
5. Register the import in `translations/index.ts` (n/a — currently
   each is imported individually in `lib/i18n/index.ts`).
6. Update `app/robots.ts` allow list.

## Production deployment notes

- **Edge geo headers** — confirmed working with Cloudflare
  (`cf-ipcountry`) and Vercel (`x-vercel-ip-country`). The Traefik
  ingress in front of bet currently does NOT inject a country
  header; ops will need to enable Cloudflare in front of it or
  add a small ipdata/geoip lookup. Without geo headers, middleware
  falls through to `Accept-Language` then `DEFAULT_LOCALE` — which
  is fine, just less optimal first-visit UX.
- **Cookie security** — `preferred_language` is non-HttpOnly so the
  switcher can read it client-side. Value is a 2-letter code,
  zero sensitivity. `Secure` + `SameSite=Lax`.
- **Cache headers** — pages under `[locale]` are `force-dynamic`
  (per-page metadata varies by locale). If you want shared CDN
  caching, configure `Vary: Cookie` at Traefik so different
  preferred-language cookies get separate cache entries.
- **Bots** — only the well-known crawler User-Agent list in
  `isLikelyBot` skips the geo flow. Unknown crawlers get treated
  as humans (geo-routed) — acceptable because the content they
  index is still the right locale per their geo, just less
  deterministic.

## Migration completed in this PR

Every user-facing route now lives under `app/[locale]/*`:

```
app/[locale]/
  page.tsx              landing
  not-found.tsx         localized 404
  layout.tsx            hreflang + canonical
  achievements/
  forgot/               password-reset request
  kyc/
  leaderboard/
  login/
  markets/
    page.tsx
    [slug]/
      page.tsx
      opengraph-image.tsx
  notifications/
  portfolio/
  profile/
  register/
  reset/                password-reset complete
  verify/               email-verify
  wallet/
    page.tsx
    withdraw/
```

Non-localized (intentionally):

```
app/admin/      Operator surface (English-only by policy)
app/api/        HTTP API routes
app/share/      Server-rendered share previews (the public auction
                share page uses crawler-friendly OG previews and
                doesn't need a locale prefix — referenced externally
                by social-media unfurl bots)
```

The middleware uses a prefix-match guard with explicit
`NON_LOCALIZED_PREFIXES` for the carve-outs above.

## Localizing dynamic DB-driven content

Static UI strings live in the four locale dictionaries. **Dynamic
content authored by admins** (market titles + descriptions) is a
different problem — we can't ship every translation in `en.ts` because
the corpus grows with every new market.

### Architecture: sidecar translation table

```
Market (canonical row)
  ├─ title         "Will the Fed cut rates in Q3?"
  ├─ description   "Resolves YES if the Federal Open Market…"
  └─ translations  → MarketTranslation[]
                    ├─ (marketId, "pt") title="…?", description="…"
                    ├─ (marketId, "es") title="…?", description=null
                    └─ (marketId, "fr") title=null,  description=null
```

- **One row per `(marketId, locale)` pair**, only inserted when a
  translation actually exists. Untranslated markets stay zero-row in
  the sidecar — no row-duplication for the long tail.
- **Per-field nullability** — title and description columns are both
  nullable, so a translator can fill title now, description later.
  Reader-side fallback picks each field independently.
- **Cascade delete** — orphan translations are useless and would
  otherwise block admin Market deletion.

### Reader API

```ts
import {
  marketTranslationInclude,
  resolveMarketContent,
} from "@/lib/i18n";

// Side-load the translation row for this locale in one round-trip:
const market = await db.market.findUnique({
  where: { slug },
  include: marketTranslationInclude(locale),
});

// Per-field fallback — translation wins if non-null/non-empty,
// else canonical fields are used:
const { title, description, titleTranslated } =
  resolveMarketContent(market, locale);
```

`resolveMarketContent` always returns non-null strings; the
`titleTranslated` / `descriptionTranslated` flags are handy for
rendering a "Translated" admin badge.

### Typed enum formatters

For non-text dynamic fields (categories, statuses, outcomes,
sort/filter values) use the typed helpers in `market-format.ts` so
adding a new enum value to Prisma fails the TS build until the
translation key is mapped:

```ts
import {
  formatCategory,     // POLITICS → "Política" / "Politics" / "Politique"
  formatStatus,       // OPEN → "abierto" / "open" / "ouvert"
  formatOutcome,      // YES → "SIM" / "YES" / "OUI"
  formatResolvedAs,   // → "Resolvido SIM" / "Resolved YES"
  formatTradeAction,  // BUY → "COMPRAR" / "BUY" / "ACHETER"
  formatTradeActionWithOutcome, // → "Comprar SIM"
  listCategories,     // pre-built [{value, label}] for dropdowns
  listSorts,
  listFilters,
} from "@/lib/i18n";
```

All wrap `t(key, locale)` so the English-fallback semantics still
apply: a brand-new enum value renders sanely as soon as it's added
to `en.ts`, even before pt/es/fr translators have caught up.

### Adding translations operationally

Out of scope for the current PR but the schema supports it:

1. Admin UI shows a "Translate" tab on the market editor with one
   text-area pair per locale.
2. Save = `upsert` on `(marketId, locale)`. Empty fields = no row
   (delete on save-empty).
3. Display layer picks up the new translation on the next request
   — no client deploy, no cache invalidation beyond Next's per-
   request rendering.

Optional follow-ups: machine-translation worker that backfills
`MarketTranslation` rows whenever a new Market is created (cheap
GPT-4o-mini call; admin can override), and a "translation completeness"
column on the admin market list so operators see which markets need
attention.

## What's NOT in this PR

- **Full translation coverage** — the dictionary keys for nav,
  landing, wallet, market, and auth are in place across en/pt/es/fr,
  but individual page strings still need refinement. Missing keys
  fall back to English via the deep walker, so a partial dictionary
  doesn't break the UI.
- **i18n for auctions + aviator apps** — they reuse the same
  `lib/i18n` shape; promote to a shared package when ready.
- **ICU-style format strings** (`{n,number,percent}`). Current `t()`
  does `{var}` substitution. For numbers/dates, format via
  `Intl.NumberFormat(locale).format(n)` / `date.toLocaleString(locale)`
  ahead of the `t()` call.
