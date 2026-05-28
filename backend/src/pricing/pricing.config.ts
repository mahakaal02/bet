/**
 * Static, infrequently-changing configuration for the PPP pricing
 * system. None of this is a *price* — it's the catalog of countries we
 * sell in, their ISO currency, and how each currency should be rounded
 * psychologically. Actual prices are computed at sync time and stored
 * in `RegionalCoinPricing`.
 *
 * Adding a market = add a row to COUNTRY_CATALOG. The forex + PPP
 * providers and the pricing engine pick it up automatically on the
 * next sync; nothing else needs to change.
 */

/**
 * Rounding strategy keys. Each maps to an implementation in
 * `regional-rounding.ts`. Chosen so the published price hits the
 * culturally-expected "charm" point for that market.
 *
 *   charm_99_minor   → nearest x.99 in the minor-unit currency (USD,
 *                      EUR, BRL, AED). 0.91 → 0.99, 4.30 → 4.99.
 *   charm_9_whole    → nearest whole number ending in 9, scaled to
 *                      magnitude (INR, PHP, MXN). 33 → 39, 142 → 149.
 *   nearest_10_whole → nearest 10 whole units, no decimals (JPY).
 *                      143 → 150.
 *   nearest_100_whole→ nearest 100 whole units (IDR — rupiah are
 *                      tiny). 14 250 → 14 300, 5 655 → 5 700.
 *   nearest_500_whole→ nearest 500 whole units (high-magnitude minor
 *                      currencies like IDR packs / NGN). 33 100 →
 *                      33 500.
 */
export type RoundingStrategy =
  | 'charm_99_minor'
  | 'charm_9_whole'
  | 'nearest_10_whole'
  | 'nearest_100_whole'
  | 'nearest_500_whole';

export interface CountryConfig {
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** ISO 4217. */
  currency: string;
  /** Number of fractional digits the currency conventionally uses
   *  (2 for USD/EUR, 0 for JPY/IDR). Drives both display + rounding. */
  fractionDigits: number;
  /** Psychological rounding applied to the raw computed price. */
  rounding: RoundingStrategy;
  /** Human label for the admin dashboard. */
  name: string;
}

/**
 * The baseline country whose PPP multiplier is normalized to exactly
 * 1.0. Every other country's affordability is expressed relative to
 * this one. USA is the canonical Steam/Netflix anchor.
 */
export const BASELINE_COUNTRY = 'US';

/**
 * Multiplier clamp. PPP data can produce absurd outliers (a tiny
 * tax-haven with sky-high GDP/capita, or a missing-data zero). We
 * clamp the normalized multiplier into this band so a single bad
 * datum can't price a market at 10× or 0.01×. Surfaced in the
 * "suspicious PPP" admin log when a value is clamped.
 */
export const MULTIPLIER_FLOOR = 0.25;
export const MULTIPLIER_CEIL = 1.25;

/**
 * Supported markets. Superset of the 11 the hub login already knows
 * about, plus JP/TR/CH which the spec calls out for rounding/PPP
 * examples. country → currency → rounding.
 */
// `fractionDigits` MUST agree with the rounding strategy: a
// whole-number charm point (charm_9_whole / nearest_*_whole) displays
// 0 decimals (₹39, not ₹39.00; ₺29; ₦499), while a minor-unit charm
// point (charm_99_minor) displays 2 (R$4.99, $0.99). The engine's
// `toFixed(fractionDigits)` relies on this invariant.
export const COUNTRY_CATALOG: readonly CountryConfig[] = [
  { country: 'US', currency: 'USD', fractionDigits: 2, rounding: 'charm_99_minor', name: 'United States' },
  { country: 'IN', currency: 'INR', fractionDigits: 0, rounding: 'charm_9_whole', name: 'India' },
  { country: 'BR', currency: 'BRL', fractionDigits: 2, rounding: 'charm_99_minor', name: 'Brazil' },
  { country: 'TR', currency: 'TRY', fractionDigits: 0, rounding: 'charm_9_whole', name: 'Türkiye' },
  { country: 'JP', currency: 'JPY', fractionDigits: 0, rounding: 'nearest_10_whole', name: 'Japan' },
  { country: 'ID', currency: 'IDR', fractionDigits: 0, rounding: 'nearest_500_whole', name: 'Indonesia' },
  { country: 'NG', currency: 'NGN', fractionDigits: 0, rounding: 'charm_9_whole', name: 'Nigeria' },
  { country: 'PH', currency: 'PHP', fractionDigits: 0, rounding: 'charm_9_whole', name: 'Philippines' },
  { country: 'MX', currency: 'MXN', fractionDigits: 2, rounding: 'charm_99_minor', name: 'Mexico' },
  { country: 'FR', currency: 'EUR', fractionDigits: 2, rounding: 'charm_99_minor', name: 'France' },
  { country: 'AE', currency: 'AED', fractionDigits: 2, rounding: 'charm_99_minor', name: 'United Arab Emirates' },
  { country: 'CN', currency: 'CNY', fractionDigits: 0, rounding: 'charm_9_whole', name: 'China' },
  { country: 'CH', currency: 'CHF', fractionDigits: 2, rounding: 'charm_99_minor', name: 'Switzerland' },
  { country: 'GB', currency: 'GBP', fractionDigits: 2, rounding: 'charm_99_minor', name: 'United Kingdom' },
  { country: 'RU', currency: 'RUB', fractionDigits: 0, rounding: 'charm_9_whole', name: 'Russia' },
  { country: 'ZA', currency: 'ZAR', fractionDigits: 0, rounding: 'charm_9_whole', name: 'South Africa' },
] as const;

/** Quick lookup: country code → config. */
export const COUNTRY_BY_CODE: ReadonlyMap<string, CountryConfig> = new Map(
  COUNTRY_CATALOG.map((c) => [c.country, c]),
);

/** All ISO currency codes we need a forex rate for. */
export const SUPPORTED_CURRENCIES: readonly string[] = Array.from(
  new Set(COUNTRY_CATALOG.map((c) => c.currency)),
);

/** All country codes we generate pricing for. */
export const SUPPORTED_COUNTRIES: readonly string[] = COUNTRY_CATALOG.map(
  (c) => c.country,
);

/**
 * Fallback region used when a user's detected country isn't in the
 * catalog. The pricing API first tries the exact country, then the
 * nearest configured neighbour from this map, then finally USD/US.
 *
 * Keys are countries we DON'T price directly; values are the catalog
 * country whose pricing is the closest affordability proxy. Extend as
 * needed — anything not listed falls through to the USD baseline.
 */
export const NEAREST_REGION_FALLBACK: Readonly<Record<string, string>> = {
  // South Asia → India
  PK: 'IN',
  BD: 'IN',
  LK: 'IN',
  NP: 'IN',
  // SE Asia → Indonesia / Philippines
  MY: 'ID',
  TH: 'ID',
  VN: 'ID',
  SG: 'US', // high income — USD baseline is closer than IDR
  // LATAM → Brazil / Mexico
  AR: 'BR',
  CO: 'MX',
  CL: 'MX',
  PE: 'MX',
  // Eurozone → France (EUR)
  DE: 'FR',
  ES: 'FR',
  IT: 'FR',
  NL: 'FR',
  PT: 'FR',
  IE: 'FR',
  // Gulf → UAE
  SA: 'AE',
  QA: 'AE',
  KW: 'AE',
  // Africa → Nigeria / South Africa
  KE: 'NG',
  GH: 'NG',
  EG: 'NG',
  // CIS → Russia
  UA: 'RU',
  KZ: 'RU',
};

/**
 * The currency a country bills in, regardless of whether we price it
 * directly. Used by the fallback path so a German user paying in EUR
 * sees EUR even though we proxy Germany's affordability to France.
 * (France is also EUR, so this is consistent.)
 */
export const COUNTRY_TO_CURRENCY: Readonly<Record<string, string>> =
  Object.fromEntries(COUNTRY_CATALOG.map((c) => [c.country, c.currency]));
