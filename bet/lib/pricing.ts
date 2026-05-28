import "server-only";
import { headers, cookies } from "next/headers";

/** Cookie the Kalki hub's country switcher writes (1-year TTL). Shared
 *  across localhost ports, so the country a user picks on the hub
 *  drives the wallet's pricing region too. */
const LOCALE_COOKIE = "kalki_locale";

/**
 * Server-side bridge from the bet (Kalki Exchange) wallet to the
 * backend's PPP pricing system (see backend/PRICING.md).
 *
 * The wallet sells GLOBAL coin packs; only the fiat price varies by
 * country. The authoritative localized price lives on the backend
 * (`GET /pricing/current`), keyed by the user's region. This helper:
 *
 *   1. reads the caller's geo signals from the incoming request,
 *   2. forwards them to the backend pricing API (server-to-server),
 *   3. returns a coins→{currency,price,symbol} map the wallet renders.
 *
 * Graceful degradation: if the backend is unreachable or no pricing
 * snapshot is published, returns `null` and the wallet falls back to
 * its legacy INR display. Never throws into the page render.
 */

const BACKEND = (
  process.env.AUCTIONS_BACKEND_URL ??
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  "http://localhost:4000"
).replace(/\/$/, "");

export interface LocalizedPack {
  coins: number;
  /** ISO 4217, e.g. "INR". */
  currency: string;
  /** Already charm-rounded by the backend, e.g. "29" or "1.99". */
  price: string;
  /** Narrow currency symbol for display, e.g. "₹" / "₺" / "¥". */
  symbol: string;
}

export interface LocalizedPricing {
  /** Region the price was resolved for (after fallback). */
  country: string;
  currency: string;
  symbol: string;
  effectiveYear: number;
  /** coins → localized pack. Lets the wallet merge by coin count. */
  byCoins: Map<number, LocalizedPack>;
}

interface PricingResponse {
  effectiveYear: number;
  country: string;
  currency: string;
  packs: Array<{ coins: number; currency: string; price: string }>;
}

/** Narrow currency symbol via Intl, falling back to the ISO code. */
function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

/**
 * Currencies billed in whole units only (no minor unit). For these,
 * the processor `amount` is the price as-is; for everything else it's
 * price × 100 (paise/cents). Mirrors the backend catalog's
 * `fractionDigits: 0` entries.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  "JPY",
  "IDR",
  "INR",
  "TRY",
  "NGN",
  "PHP",
  "CNY",
  "RUB",
  "ZAR",
]);

export interface ResolvedPackPrice {
  coins: number;
  currency: string;
  /** Charm-rounded price as a decimal string, e.g. "29" or "1.99". */
  price: string;
  /** Smallest-unit integer for the payment processor (paise/cents, or
   *  the whole amount for zero-decimal currencies like JPY/INR). */
  amountMinor: number;
  /** Whole-unit amount for the audit-row Int column. */
  amountWhole: number;
}

/**
 * Server-derive the localized price for ONE pack (by coin count) for
 * the current request's region. Used by the checkout route so the
 * charged amount is computed SERVER-SIDE from the authoritative
 * backend pricing — it NEVER trusts a client-supplied price
 * (anti-abuse / anti-arbitrage). Returns null when no localized
 * pricing is available; the caller then falls back to legacy INR.
 */
export async function resolvePackPrice(
  coins: number,
  localeHint?: string,
): Promise<ResolvedPackPrice | null> {
  const pricing = await fetchLocalizedPricing(localeHint);
  const loc = pricing?.byCoins.get(coins);
  if (!loc) return null;
  const priceNum = Number(loc.price);
  if (!Number.isFinite(priceNum) || priceNum <= 0) return null;
  const zeroDecimal = ZERO_DECIMAL_CURRENCIES.has(loc.currency);
  return {
    coins,
    currency: loc.currency,
    price: loc.price,
    amountMinor: zeroDecimal
      ? Math.round(priceNum)
      : Math.round(priceNum * 100),
    amountWhole: Math.ceil(priceNum),
  };
}

/**
 * Estimated local-currency value of a coin balance, anchored to the
 * 1000-coin pack's localized price:
 *
 *   per-coin = price(1000-pack) / 1000
 *   value    = balance × per-coin
 *
 * i.e. "what the user effectively paid per coin" in their region — NOT
 * a cash-out promise. Returns a formatted currency string (e.g.
 * "₹2,650" / "$626.96") or `null` when there's no published 1000-coin
 * pack price to anchor on (caller then shows nothing / falls back).
 */
export function coinValueLabel(
  balanceCoins: number,
  pricing: LocalizedPricing | null,
): string | null {
  const anchor = pricing?.byCoins.get(1000);
  if (!anchor) return null;
  const per1000 = Number(anchor.price);
  if (!Number.isFinite(per1000) || per1000 <= 0) return null;
  const value = (per1000 / 1000) * Math.max(0, balanceCoins);
  const zeroDecimal = ZERO_DECIMAL_CURRENCIES.has(anchor.currency);
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: anchor.currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: zeroDecimal ? 0 : 2,
      maximumFractionDigits: zeroDecimal ? 0 : 2,
    }).format(value);
  } catch {
    return `${anchor.symbol}${value.toFixed(zeroDecimal ? 0 : 2)}`;
  }
}

/**
 * Map a UI locale to a sensible billing region. A non-English UI locale
 * is a strong signal of where the user is reading from, so it drives the
 * wallet currency when present (es→Spain/EUR, fr→France/EUR, pt→Brazil/
 * BRL). English is global, so it returns null and we fall through to the
 * explicit hub choice → real geolocation → Accept-Language → US baseline.
 */
function localeToCountry(locale?: string): string | null {
  switch ((locale ?? "").toLowerCase()) {
    case "es":
      return "ES";
    case "fr":
      return "FR";
    case "pt":
      return "BR";
    default:
      return null;
  }
}

export async function fetchLocalizedPricing(
  localeHint?: string,
): Promise<LocalizedPricing | null> {
  try {
    const h = await headers();
    const jar = await cookies();
    // Region resolution order:
    //   1. `kalki_locale` cookie — the user's EXPLICIT country choice
    //      from the hub switcher. Wins so "change country → change
    //      price" works, and so local dev (no edge geo header) still
    //      reflects the picked country.
    //   2. cf-ipcountry / x-vercel-ip-country — real edge geo in prod.
    //   3. Accept-Language — browser locale fallback.
    // We forward the resolved country to the backend as cf-ipcountry
    // (its medium-trust geo slot) plus Accept-Language as a backstop.
    // Region resolution order:
    //   1. UI locale → region (es/fr/pt) — the language the user chose.
    //   2. `kalki_locale` cookie — explicit hub country pick.
    //   3. cf-ipcountry / x-vercel / x-real-country — real edge geo (prod).
    //   4. (Accept-Language, forwarded below; backend maps it.)
    //   5. backend default (US baseline).
    const localeRegion = localeToCountry(localeHint);
    const explicit = jar.get(LOCALE_COOKIE)?.value?.toUpperCase() || null;
    const geo =
      localeRegion ??
      explicit ??
      h.get("cf-ipcountry") ??
      h.get("x-vercel-ip-country") ??
      h.get("x-real-country") ??
      null;
    const acceptLanguage = h.get("accept-language");

    const res = await fetch(`${BACKEND}/pricing/current`, {
      headers: {
        ...(geo ? { "cf-ipcountry": geo } : {}),
        ...(acceptLanguage ? { "accept-language": acceptLanguage } : {}),
      },
      // No bet-layer caching — the backend already caches per-country
      // in Redis (7-day TTL). A URL-keyed Next cache here would serve
      // one country's price to everyone.
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;

    const body = (await res.json()) as PricingResponse;
    if (!body?.packs?.length) return null;

    const symbol = currencySymbol(body.currency);
    const byCoins = new Map<number, LocalizedPack>();
    for (const p of body.packs) {
      byCoins.set(p.coins, {
        coins: p.coins,
        currency: p.currency,
        price: p.price,
        symbol: currencySymbol(p.currency),
      });
    }

    return {
      country: body.country,
      currency: body.currency,
      symbol,
      effectiveYear: body.effectiveYear,
      byCoins,
    };
  } catch {
    // Backend down / timeout / no snapshot — wallet shows legacy INR.
    return null;
  }
}
