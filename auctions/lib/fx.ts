import "server-only";

/**
 * Server-side FX rate fetcher.
 *
 * Goal — surface auction prices in the viewer's selected currency
 * without committing hardcoded conversion rates. The hub stores
 * `Auction.retailPrice` in INR (backend seed + admin UI are
 * INR-denominated); when a user flips the country selector to e.g.
 * Brazil, we need a credible BRL number instead of just swapping
 * the symbol.
 *
 * Source strategy — two free, no-auth APIs in order:
 *
 *   1. **Frankfurter** (`api.frankfurter.app`) — daily ECB closing
 *      reference rates, supports historical lookup by ISO date.
 *      Used for the previous business day's close so the rate is
 *      the canonical "yesterday's closing price". Covers EUR, USD,
 *      BRL, PHP, CNY, MXN, IDR, INR among others.
 *
 *   2. **Open Exchange Rates free open endpoint**
 *      (`open.er-api.com/v6/latest/USD`) — daily refresh, no auth,
 *      covers ~160 currencies including NGN and AED that the ECB
 *      list lacks. RUB is also absent from ECB (sanctions-driven
 *      suspension since 2022) so we get it from here too.
 *
 * Output is INR-base (the auctions backend's storage unit). For
 * each target currency we report "how many of THIS currency 1 INR
 * buys" — same semantics as the deleted `fromINR` literals.
 *
 * Caching — Next.js's data cache (`fetch` with `next.revalidate`)
 * stamps the upstream response for 6h. That covers a normal trading
 * day with one revalidate, surviving FX-source minor outages on the
 * stale-while-revalidate path.
 *
 * Fallback — if BOTH upstreams fail (genuine internet outage), we
 * return an empty rates object. The hub uses `rates[code] ?? 1` so
 * the displayed amount equals the raw INR figure — same behaviour
 * as showing INR everywhere. The currency SYMBOL still flips but
 * the user sees "$ 29,000" which is at least internally consistent
 * (the proportions are wrong, but no value is hallucinated). A
 * future enhancement could surface a "(rates unavailable, showing
 * INR)" note in the UI.
 */

const FRANKFURTER_BASE = "https://api.frankfurter.app";
const ER_API_LATEST = "https://open.er-api.com/v6/latest/USD";

/** Currency ISO 4217 codes the hub renders prices in. Used both as
 *  the Frankfurter `to=` list and as the keys downstream code reads. */
const TARGETS = [
  "USD",
  "EUR",
  "BRL",
  "RUB",
  "PHP",
  "CNY",
  "MXN",
  "IDR",
  "NGN",
  "AED",
] as const;

export type CurrencyCode =
  | "INR"
  | (typeof TARGETS)[number];

export interface FxRates {
  /** INR base — rates[code] = how many `code` units one INR buys. */
  rates: Partial<Record<CurrencyCode, number>>;
  /** ISO timestamp when we last successfully refreshed. */
  fetchedAt: string;
  /** Source(s) the rates came from, for ops debugging. */
  source: string;
  /** Date string (YYYY-MM-DD) the Frankfurter closing rates correspond
   *  to. Empty when we fell back to live rates only. */
  ratesDate: string;
}

/**
 * Yesterday's date in UTC as YYYY-MM-DD. Frankfurter returns the
 * most recent business-day close on or before this date, so e.g. a
 * Sunday request quietly resolves to the previous Friday's close.
 */
function previousDayIso(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * Try Frankfurter for the previous-day INR-base rates. Returns the
 * subset of TARGETS that resolved, plus the actual date Frankfurter
 * served (may be older than requested on weekends / ECB holidays).
 */
async function fetchFrankfurter(): Promise<{
  rates: Partial<Record<CurrencyCode, number>>;
  date: string;
} | null> {
  // Frankfurter intersects our TARGETS — strip the ones it can't serve
  // so the request URL is well-formed. NGN, AED, RUB are excluded.
  const supported: CurrencyCode[] = [
    "USD",
    "EUR",
    "BRL",
    "PHP",
    "CNY",
    "MXN",
    "IDR",
  ];
  const date = previousDayIso();
  const url = `${FRANKFURTER_BASE}/${date}?from=INR&to=${supported.join(",")}`;
  try {
    const res = await fetch(url, {
      // 6h cache so a single rate-source flap doesn't ripple to users.
      next: { revalidate: 6 * 60 * 60 },
      // Don't block deploys behind FX provider latency.
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      rates?: Record<string, number>;
      date?: string;
    };
    if (!body.rates) return null;
    const out: Partial<Record<CurrencyCode, number>> = {};
    for (const k of Object.keys(body.rates)) {
      if (Number.isFinite(body.rates[k])) {
        out[k as CurrencyCode] = body.rates[k];
      }
    }
    return { rates: out, date: body.date ?? date };
  } catch {
    return null;
  }
}

/**
 * Open ER API gives latest rates with USD as base. Re-base to INR by
 * dividing every cross-rate by the USD→INR rate.
 */
async function fetchOpenER(): Promise<Partial<Record<CurrencyCode, number>>> {
  try {
    const res = await fetch(ER_API_LATEST, {
      next: { revalidate: 6 * 60 * 60 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return {};
    const body = (await res.json()) as {
      rates?: Record<string, number>;
      result?: string;
    };
    if (body.result !== "success" || !body.rates) return {};
    const inrPerUsd = body.rates.INR;
    if (!Number.isFinite(inrPerUsd) || inrPerUsd <= 0) return {};
    const out: Partial<Record<CurrencyCode, number>> = {};
    for (const code of TARGETS) {
      const usdRate = body.rates[code];
      if (Number.isFinite(usdRate) && usdRate > 0) {
        // 1 INR worth of `code` = (`code` per USD) / (INR per USD)
        out[code] = usdRate / inrPerUsd;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Resolve the full INR-base rate table. Frankfurter is primary
 * (yesterday's ECB close); Open ER API plugs in NGN/AED/RUB and
 * acts as fallback if Frankfurter fails entirely.
 *
 * `INR` is always present with rate 1 — the identity element.
 */
export async function loadFxRates(): Promise<FxRates> {
  const [primary, fallback] = await Promise.all([
    fetchFrankfurter(),
    fetchOpenER(),
  ]);

  const rates: Partial<Record<CurrencyCode, number>> = { INR: 1 };
  for (const code of TARGETS) {
    if (primary?.rates[code] !== undefined) {
      rates[code] = primary.rates[code];
    } else if (fallback[code] !== undefined) {
      rates[code] = fallback[code];
    }
  }

  let source = "none";
  if (primary && Object.keys(fallback).length > 0) source = "frankfurter+open-er-api";
  else if (primary) source = "frankfurter";
  else if (Object.keys(fallback).length > 0) source = "open-er-api";

  return {
    rates,
    fetchedAt: new Date().toISOString(),
    source,
    ratesDate: primary?.date ?? "",
  };
}

/**
 * Convert an INR amount (string from backend or raw number) to the
 * selected currency using runtime-fetched rates. Returns 0 for
 * non-finite inputs; falls back to the raw INR figure when the
 * target rate is missing (offline / FX source down).
 */
export function convertFromINR(
  inrAmount: string | number,
  targetCode: CurrencyCode,
  rates: Partial<Record<CurrencyCode, number>>,
): number {
  const n = typeof inrAmount === "string" ? Number(inrAmount) : inrAmount;
  if (!Number.isFinite(n)) return 0;
  const rate = rates[targetCode];
  if (!Number.isFinite(rate) || rate === undefined || rate <= 0) {
    // No rate available — render the INR figure as-is. Better than
    // hallucinating a conversion.
    return Math.round(n);
  }
  return Math.round(n * rate);
}
