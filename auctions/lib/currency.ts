import "server-only";

/**
 * Location-driven money formatting for the auctions surfaces.
 *
 * The backend stores `Auction.retailPrice` (and other fiat figures) in
 * INR. Rather than hardcoding "₹" + `en-IN` at every call site, we
 * resolve the viewer's country (see `lib/locale-detect.ts::detectCountry`,
 * which reads `?locale` → `kalki_locale` cookie → geo header →
 * Accept-Language → IN) and render the amount in THAT location's
 * currency, converting via the runtime FX table (`lib/fx.ts`).
 *
 * This mirrors the mechanism the hub already uses in `hub-client.tsx`,
 * lifted into a shared, server-importable helper so the auctions
 * catalog / detail / watchlist / share pages all localise identically.
 */

import { convertFromINR, type CurrencyCode, type FxRates } from "./fx";
import type { CountryCode } from "./locale-detect";

export interface CurrencyInfo {
  /** Display symbol/prefix (trailing space already baked in where the
   *  ISO code doubles as the symbol, e.g. "AED "). */
  symbol: string;
  /** ISO 4217 code — the key into the FX rate table. */
  code: CurrencyCode;
  /** BCP-47 tag for digit grouping (e.g. "en-IN" → 1,23,456). */
  numberFmt: string;
}

/**
 * Country → currency. Keep in sync with `SUPPORTED_COUNTRIES` in
 * `lib/locale-detect.ts` and the LOCALE table in `hub-client.tsx`.
 */
export const CURRENCY_BY_COUNTRY: Record<CountryCode, CurrencyInfo> = {
  IN: { symbol: "₹", code: "INR", numberFmt: "en-IN" },
  BR: { symbol: "R$", code: "BRL", numberFmt: "pt-BR" },
  FR: { symbol: "€", code: "EUR", numberFmt: "fr-FR" },
  RU: { symbol: "₽", code: "RUB", numberFmt: "ru-RU" },
  PH: { symbol: "₱", code: "PHP", numberFmt: "en-PH" },
  CN: { symbol: "¥", code: "CNY", numberFmt: "zh-CN" },
  MX: { symbol: "MX$", code: "MXN", numberFmt: "es-MX" },
  ID: { symbol: "Rp", code: "IDR", numberFmt: "id-ID" },
  NG: { symbol: "₦", code: "NGN", numberFmt: "en-NG" },
  AE: { symbol: "AED ", code: "AED", numberFmt: "en-AE" },
  US: { symbol: "$", code: "USD", numberFmt: "en-US" },
};

export function currencyForCountry(country: CountryCode): CurrencyInfo {
  return CURRENCY_BY_COUNTRY[country] ?? CURRENCY_BY_COUNTRY.IN;
}

/**
 * Format an INR-denominated amount in the viewer's local currency:
 * convert via FX, group digits per the locale, prefix the symbol.
 * When the FX rate is unavailable `convertFromINR` returns the raw INR
 * figure, so the symbol still localises and no value is hallucinated.
 */
export function formatMoneyFromINR(
  inrAmount: string | number,
  country: CountryCode,
  rates: FxRates["rates"],
): string {
  const info = currencyForCountry(country);
  const value = convertFromINR(inrAmount, info.code, rates);
  return `${info.symbol}${value.toLocaleString(info.numberFmt)}`;
}

/**
 * Group a non-fiat number (e.g. a coin amount) per the viewer's
 * locale, WITHOUT a currency symbol — coins are not fiat. `digits`
 * controls fraction digits (bid amounts carry 2; counts carry 0).
 */
export function formatLocalNumber(
  amount: string | number,
  country: CountryCode,
  digits = 0,
): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(currencyForCountry(country).numberFmt, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
