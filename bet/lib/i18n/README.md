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

## Accessibility & RTL readiness

### `<html lang>` + `<html dir>` — server-resolved

The root `app/layout.tsx` reads the resolved locale from a request
header that middleware sets (`x-bet-locale`) and emits the correct
`<html lang>` and `<html dir>` *before any HTML ships*. Why server-
side instead of a client-side flip?

- Screen readers read the initial `lang` value the moment the document
  loads. A `useEffect` that swaps it post-hydration is too late —
  the announcement has already happened in the wrong language.
- `dir` controls the entire visual layout via CSS logical properties.
  Flipping it client-side causes a layout flash on every navigation.

For non-localized routes (`/admin/*`, `/share/*`, error pages), the
header is absent and we fall back to `DEFAULT_LOCALE` ("en"). This
is the single source of truth — assistive tech keys off it.

### LanguageSwitcher — WAI-ARIA listbox pattern

`components/LanguageSwitcher.tsx` implements the full
[WAI-ARIA Listbox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/):

| Action | Result |
|---|---|
| Click / Enter / Space / ↓ on trigger | Open menu, highlight current locale |
| ↓ inside menu | Next option (wraps) |
| ↑ inside menu | Previous option (wraps) |
| Home / End | First / last option |
| Type a letter | Jump to first option starting with that letter |
| Enter / Space | Select highlighted option |
| Tab | Close menu, let focus advance (matches native `<select>`) |
| Escape | Cancel, return focus to trigger |
| Click outside | Close, return focus to trigger |

Implementation notes:

- `aria-activedescendant` points at the currently-highlighted `<li>`
  so screen readers announce the choice without DOM focus moving.
- All options have `min-h-11` (44px) for touch targets per WCAG 2.5.5.
- Visible focus ring via `focus-visible:ring-cyan-400/60`.
- `aria-haspopup="listbox"`, `aria-expanded`, `aria-controls`, and
  `aria-label={t("switcher.label", locale)}` on the trigger.

### Future RTL — what's already in place

When we add `ar` / `he` / `fa` / `ur`, the only mechanical edits
required are:

1. Add the code to `LOCALES`, `LOCALE_DISPLAY`, `COUNTRY_TO_LOCALE`
   in `config.ts`.
2. Add the code to `RTL_LOCALES` (also in `config.ts`).
3. Ship a `translations/<code>.ts` dictionary.

The display layer is already RTL-safe because:

- Every directional CSS class in user-facing code uses Tailwind 4
  logical utilities (`me-`, `ms-`, `pe-`, `ps-`, `start-N`, `end-N`,
  `text-start`, `text-end`, `rounded-ss-`, etc.). These resolve
  through `padding-inline-start` / `inset-inline-end` / etc., which
  flip automatically when `dir="rtl"` is set on `<html>`.
- The LanguageSwitcher's `align="end"` prop maps to `end-0` — anchors
  the dropdown to the text-flow end, which is right in LTR and left
  in RTL. No re-layout needed.
- Icon-bearing chevrons (`rotate-180` on open) are symmetric about
  the vertical axis, so the visual still reads "down to expand"
  regardless of writing direction.

Things deliberately LEFT directional:

- The order book ladder (`OrderBookLadder.tsx`) keeps BID/ASK on
  their conventional sides — these carry trading semantics, not
  text direction. We color-code (emerald = bid, rose = ask) so
  RTL readers identify them by color, not position.
- Number-mono columns (volume, P/L, prices) stay LTR — numbers
  are universally LTR even in RTL languages. Tailwind's
  `font-mono` already preserves this.

### `dir`/`lang` propagation tested

`__tests__/i18n-direction.test.ts` locks in:
- All currently-shipped locales (en/pt/es/fr) → "ltr"
- Anything in `RTL_LOCALES` → "rtl"
- Unknown locales default to "ltr" (safe fallback)
- `RTL_LOCALES` is a Set (O(1) lookup)

When an RTL locale is added the test suite immediately verifies
the direction without needing fixture updates — just append to
`RTL_LOCALES` and run.

## Analytics safety — preserved attribution across locale changes

### Invariant: marketing state survives every locale redirect

UTM tags, click IDs, referral codes, and any other query state attached
to an inbound link must survive both:

1. The middleware's geo / cookie / Accept-Language redirect
   (`/wallet?utm_campaign=launch` → `/pt/wallet?utm_campaign=launch`)
2. The user clicking the language switcher mid-session
   (`/pt/wallet?utm_campaign=launch` → `/en/wallet?utm_campaign=launch`)

Otherwise a user who arrives via a campaign link and then changes
language to read the page appears to your analytics as "direct" —
breaking attribution and the whole funnel-by-source dashboard.

How it's enforced:

- **Middleware** clones the entire `nextUrl` (`req.nextUrl.clone()`)
  before mutating only the path — every query parameter survives
  the redirect unchanged. Tested per-tracker (UTM, gclid, fbclid,
  msclkid, _ga, ref, multi-value).
- **Language switcher** reads `useSearchParams()` and pipes the
  current query through `withPreservedParams()` when calling
  `router.push`. Target values win on conflicts (the user's
  most-recent intent — e.g. they edited the search box — beats
  whatever was on the URL when they landed).

### Tracking-param vocabulary

`lib/i18n/analytics.ts::TRACKING_PARAM_KEYS` is the canonical list:

- **UTM family** — utm_source, utm_medium, utm_campaign, utm_term,
  utm_content, utm_id
- **Ad-network click IDs** — gclid, gbraid, wbraid, dclid (Google),
  fbclid (Meta), msclkid (Bing), ttclid (TikTok), twclid (Twitter),
  yclid (Yandex), li_fat_id (LinkedIn), mc_cid/mc_eid (Mailchimp)
- **Referral / sharing** — ref, referrer, referral, referral_code,
  aff, affiliate, invite, r
- **Cross-domain session linkers** — _ga, _gl

Adding a new ad network? Append to the list — the rest of the
pipeline picks it up.

### Helpers

```ts
import {
  extractTrackingParams,    // picks known keys out of search params
  appendTrackingParams,     // attaches a subset onto a path
  withPreservedParams,      // attaches ALL params (switcher hot path)
  localeDimension,          // 'pt' — for analytics event tagging
  localeAnalyticsContext,   // { locale, language, dir } — global props
} from "@/lib/i18n";
```

`extractTrackingParams` is for downstream pipelines that specifically
want the marketing subset (e.g. when sending an event to a CDP) —
the switcher uses the broader `withPreservedParams` because UX
consistency means *all* state survives the swap (sort filters,
search text, anchors), not just attribution.

### Locale dimension for events

Pass the locale as a custom dimension on every analytics event so
dashboards can slice by language:

```ts
import { localeDimension, localeAnalyticsContext } from "@/lib/i18n";

// Per-event:
posthog.capture("trade_buy", {
  market_slug: market.slug,
  locale: localeDimension(locale),
});

// Or as global properties at page load (set once, attached to
// every subsequent event):
posthog.register(localeAnalyticsContext(locale));
// → { locale: 'pt', language: 'pt-BR', dir: 'ltr' }
```

Both helpers are pure data — zero runtime, no network. Safe to call
from server components and client components alike.

### Tested

`__tests__/i18n-analytics.test.ts` (39 cases) covers:

- UTM / gclid / fbclid / msclkid / _ga preserved through geo
  redirects, cookie redirects, default fallback, bot redirect
- referral code preserved through cookie-driven locale change
- multi-value query (search filters + UTM together) preserved
- `extractTrackingParams` handles URLSearchParams, plain Records,
  Records with arrays (Next.js searchParams shape), empty strings
- `withPreservedParams` merge semantics (target wins on conflict)
- `localeDimension` / `localeAnalyticsContext` shape for every
  supported locale

## Translation loading — bundle / hydration cost

### The problem (before optimization)

`lib/i18n/index.ts` statically imported every locale dictionary:

```ts
import en from "./translations/en";
import pt from "./translations/pt";
import es from "./translations/es";
import fr from "./translations/fr";
```

When a client component did `import { t } from "@/lib/i18n"`, the
bundler followed the import graph and pulled all four dictionaries
(~640 LoC of strings each, ~94 KB unminified total) into shared
client chunks. **Every visitor downloaded all four languages** even
though only one is rendered.

Measured baseline: a single chunk (`4515-…js`) at 93,737 bytes
contained the merged dictionary registry. Confirmed by string-grep
finding `"Mercados de previsão"` (pt), `"Mercados de predicción"`
(es), and `"Marchés de prédiction"` (fr) inside one client chunk.

### The fix — split server vs. client surface

Two entry points now:

```
lib/i18n/index.ts   — SERVER ONLY. Imports all 4 dictionaries.
                      Exposes `t()`, `dictionaryFor()`,
                      `mergeDictionaries()`, `buildLocalizedMetadata()`,
                      `alternatesFor()`, etc.

lib/i18n/client.tsx — CLIENT-SAFE. NO static dictionary imports.
                      Exposes `<I18nProvider>` + `useTranslation()`,
                      plus pure helpers (path, analytics, locale-format)
                      that have no dict dependency.
```

The localized layout (`app/[locale]/layout.tsx`) calls
`dictionaryFor(locale)` on the server, pre-merges with the English
fallback, and passes the result as a `<I18nProvider dictionary={...}>`
prop. Because the provider is a `"use client"` boundary that
*receives* the dictionary (not imports it), the bundler does NOT
include any dictionary file in any client chunk — the dictionary
travels as data in the RSC payload, scoped to the active locale.

```tsx
// app/[locale]/layout.tsx — server component
import { I18nProvider } from "@/lib/i18n/client";
import { dictionaryFor } from "@/lib/i18n";

export default async function LocaleLayout({ children, params }) {
  const { locale } = await params;
  const dict = dictionaryFor(locale);  // server-side merge
  return (
    <I18nProvider locale={locale} dictionary={dict}>
      {children}
    </I18nProvider>
  );
}
```

```tsx
// Any client component — never imports a dict
"use client";
import { useTranslation } from "@/lib/i18n/client";

export function Navbar() {
  const { t, locale, dir } = useTranslation();
  return <nav>{t("nav.markets")}</nav>;
}
```

### Measured after-state

Bundle audit (regex-grep against every `.next/static/chunks/*.js`
file for distinctive strings from each dictionary):

| Locale | Marker scanned | Hits in client chunks |
|---|---|---|
| EN | `Real-world events. Real opinions. Real stakes` | **0** |
| EN | `Pick a side, set your price` | **0** |
| PT | `Mercados de previsão` | **0** |
| ES | `Mercados de predicción` | **0** |
| FR | `Marchés de prédiction` | **0** |

The 93 KB dictionary chunk is gone. The dictionary now ships only
in the RSC payload for the active locale.

### SSR-friendly

Server rendering still uses `t(key, locale)` directly — fast, no
context plumbing. The provider is an "is React" client boundary so
during SSR it runs once to push the context, and the SSR'd HTML
already has the translated strings inlined. The hydration step
re-runs the provider on the client, reading the dictionary from the
RSC payload — no second fetch.

### Hydration cost

- `useTranslation()` only reads from context — no state, no
  effects, no subscriptions.
- The returned `t` is `useCallback`-memoised on the dictionary
  identity, which is stable across renders (the provider builds
  it once via `useMemo`). So `t` is referentially stable too —
  React's bailout machinery skips re-render of any child that
  depends on it.
- Total client-side i18n code: ~150 lines (walker + interpolator +
  context). Compare to ~640 lines per locale × 4 locales = 2,560
  lines previously shipped to every visitor.

### Lazy loading? Not needed here

We considered async `import('./translations/' + locale)` at module
boundary, but it's strictly worse than the current design for our
case:

- The dictionary is needed for the first render — async-importing
  forces a suspense boundary that adds a network round-trip on
  first paint.
- With the RSC-payload approach, the dictionary is already inlined
  into the HTML response. Zero extra round-trips.
- Per-locale chunks (`build/locales/pt.[hash].js`) would still
  trigger a network fetch when switching languages — vs. the
  current behaviour where `router.refresh()` swaps the entire
  RSC payload (including the new dictionary) in one round-trip.

### When you DO want dynamic imports

If the dictionary ever grows to a size where shipping it inline is
expensive (e.g., adding 20+ locales with rich content), wrap the
provider in a `<Suspense>` boundary and async-import the dictionary
in a server component:

```ts
const dict = await import(`@/lib/i18n/translations/${locale}`).then(
  (m) => m.default,
);
```

Today's volume (4 locales × ~640 LoC) is small enough that
inlining is cheaper than the round-trip cost. Document the
threshold; revisit when LOCALES.length ≥ 10.

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
