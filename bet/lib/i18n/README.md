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

```
Request lands → middleware (edge)
  │
  ├─ URL has /{locale}/... prefix?
  │     YES → pass through unchanged.
  │
  ├─ URL is /api/* or /admin/* or static asset?
  │     YES → pass through unchanged (excluded via matcher).
  │
  ├─ User-Agent looks like a bot?
  │     YES → 302 → /{DEFAULT_LOCALE}{path}. No cookie writes.
  │
  ├─ `preferred_language` cookie set?
  │     YES → 302 → /{cookie}{path}.  ★ MANUAL CHOICE WINS
  │
  ├─ `kalki_geo_routed` sentinel cookie set?
  │     YES → 302 → /{DEFAULT_LOCALE}{path}. (Already geo-routed
  │                  once; subsequent navigation defaults to English
  │                  unless they manually pick.)
  │
  └─ First visit:
        a. x-vercel-ip-country / cf-ipcountry / x-real-country
              → country code → COUNTRY_TO_LOCALE → 302 + write sentinel.
        b. Accept-Language → first supported locale → 302 + sentinel.
        c. DEFAULT_LOCALE → 302 + sentinel.
```

Key invariants:

- **Manual choice always wins.** The `preferred_language` cookie is
  the first check, set only by the language switcher.
- **No repeated geo prompts.** The `kalki_geo_routed` sentinel flips
  to "1" on the first redirect and stays for 30 days. Without it,
  a Brazilian user who deliberately navigates to `/en/wallet`
  would be perpetually slingshot back to `/pt/`.
- **No client-side JS redirects.** All locale routing happens at
  the edge before any HTML ships. Bots see the canonical URL on
  the first hit; users see their language without a flash.
- **302, not 301.** Geo state can change (VPN, travel) and the
  user's preference can change. Caching as permanent would break
  language switching for any client behind a proxy that respects
  301s.

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

## What's NOT in this PR

- Migrations of other existing pages (`wallet`, `markets`,
  `profile`, `login`, `register`, etc.). Mechanical follow-ups
  using the guide above. Each is a single-file PR.
- Translations for the auctions + aviator apps. They'd reuse the
  same `config.ts` shape; if the platform decides to consolidate,
  promote the i18n module to a shared package.
- ICU-style format strings (`{n,number,percent}`). The current
  `t()` does simple `{var}` substitution; richer formatting goes
  through `Intl.NumberFormat` ahead of the `t()` call.
- Locale-aware date formatting helpers. Pass a `Date` through
  `toLocaleString(locale, ...)` at the call site.
