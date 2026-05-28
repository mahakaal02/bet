/**
 * Server-side helper: the local-currency VALUE of a coin balance,
 * anchored to the backend's PPP pricing (see backend/PRICING.md).
 *
 *   per-coin = price(1000-coin pack) / 1000      (in the user's currency)
 *   value    = balance × per-coin
 *
 * i.e. "what the user effectively paid per coin" in their region — the
 * hub wallet widget renders this instead of the old 1-coin-=-₹1 figure.
 * Returns a formatted currency string (e.g. "₹2,650" / "$626.96") or
 * `null` when the backend is down / no 1000-coin pack price published.
 */

const BACKEND = (
  process.env.AUCTIONS_BACKEND_URL ??
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  "http://localhost:4000"
).replace(/\/$/, "");

// Currencies billed in whole units (no minor unit) — display 0 decimals.
const ZERO_DECIMAL = new Set([
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

interface PricingResponse {
  currency: string;
  packs: Array<{ coins: number; currency: string; price: string }>;
}

export async function fetchCoinValueLabel(
  country: string,
  balanceCoins: number,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${BACKEND}/pricing/current?country=${encodeURIComponent(country)}`,
      { cache: "no-store", signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as PricingResponse;
    const anchor = body?.packs?.find((p) => p.coins === 1000);
    if (!anchor) return null;
    const per1000 = Number(anchor.price);
    if (!Number.isFinite(per1000) || per1000 <= 0) return null;
    const value = (per1000 / 1000) * Math.max(0, balanceCoins);
    const zero = ZERO_DECIMAL.has(anchor.currency);
    try {
      return new Intl.NumberFormat("en", {
        style: "currency",
        currency: anchor.currency,
        currencyDisplay: "narrowSymbol",
        minimumFractionDigits: zero ? 0 : 2,
        maximumFractionDigits: zero ? 0 : 2,
      }).format(value);
    } catch {
      return `${anchor.currency} ${value.toFixed(zero ? 0 : 2)}`;
    }
  } catch {
    return null;
  }
}
