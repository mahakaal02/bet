import { Injectable, Logger } from '@nestjs/common';

/**
 * PPP / affordability provider abstraction.
 *
 * Returns a RAW per-country affordability signal — NOT yet normalized.
 * The pricing engine does the baseline normalization so the
 * normalization policy lives in one place and providers stay dumb.
 *
 * We use GDP per capita, PPP (current international $) as the
 * affordability proxy: a country with half the USA's GDP/capita-PPP
 * gets roughly half the multiplier (before clamping). This is the
 * same signal Steam's regional pricing is widely understood to track.
 */
export interface PppDatum {
  country: string; // ISO 3166-1 alpha-2
  /** Raw GDP-per-capita-PPP (international $). Higher = more affluent. */
  rawValue: number;
}

export interface PppDataset {
  /** country → raw value. Missing countries are absent (caller falls back). */
  byCountry: Record<string, number>;
  /** Provider identifier for the snapshot's `pppSource` column. */
  source: string;
  /** The data vintage (year) the upstream actually returned. */
  dataYear: number;
}

export abstract class PppProvider {
  abstract fetchPppData(countries: readonly string[]): Promise<PppDataset>;
}

/**
 * World Bank implementation (the spec's preferred source).
 *
 * Indicator NY.GDP.PCAP.PP.CD = "GDP per capita, PPP (current
 * international $)". The API is free, no auth, returns the most recent
 * non-null year per country when we ask for a small recent range.
 *
 *   https://api.worldbank.org/v2/country/US;IN;BR/indicator/NY.GDP.PCAP.PP.CD?format=json&mrnev=1
 *
 * `mrnev=1` = "most recent non-empty value" — one datum per country,
 * automatically skipping years a country hasn't reported yet. That
 * keeps the sync robust to the World Bank's staggered release schedule.
 */
@Injectable()
export class WorldBankPppProvider extends PppProvider {
  private readonly logger = new Logger(WorldBankPppProvider.name);
  readonly source = 'api.worldbank.org NY.GDP.PCAP.PP.CD';

  private readonly base =
    process.env.WORLDBANK_API_URL ?? 'https://api.worldbank.org/v2';
  private readonly indicator = 'NY.GDP.PCAP.PP.CD';

  async fetchPppData(countries: readonly string[]): Promise<PppDataset> {
    // World Bank uses ISO-2 codes in the path; join with ';'.
    const codes = Array.from(new Set(countries)).join(';');
    const url = new URL(
      `${this.base}/country/${codes}/indicator/${this.indicator}`,
    );
    url.searchParams.set('format', 'json');
    // `mrv=1` = "most recent 1 value" per country — returns each
    // country's latest reported year, skipping the not-yet-reported
    // current year. (The `mrnev` param documented elsewhere 400s on
    // the v2 API; `mrv` is the working equivalent.) Any country whose
    // latest datum is still null is handled by the null-guard below
    // → falls through to the multiplier floor + fallback flag.
    url.searchParams.set('mrv', '1');
    url.searchParams.set('per_page', '1000');

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(20_000),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`World Bank HTTP ${res.status}`);
    }

    // World Bank returns [ <pagination>, [ <datum>, ... ] ].
    const body = (await res.json()) as
      | [unknown, Array<{
          countryiso3code?: string;
          country?: { id?: string; value?: string };
          value: number | null;
          date?: string;
        }> | null]
      | { message?: unknown };

    if (!Array.isArray(body) || !Array.isArray(body[1])) {
      throw new Error('World Bank: unexpected response shape');
    }

    const byCountry: Record<string, number> = {};
    let dataYear = 0;
    for (const row of body[1]) {
      // The API echoes the ISO-2 code we queried in `country.id`.
      const iso2 = row.country?.id?.toUpperCase();
      if (!iso2 || row.value == null || !Number.isFinite(row.value)) continue;
      byCountry[iso2] = row.value;
      const y = row.date ? Number(row.date) : 0;
      if (y > dataYear) dataYear = y;
    }

    const missing = countries.filter((c) => byCountry[c] === undefined);
    if (missing.length > 0) {
      this.logger.warn(
        `World Bank PPP missing for: ${missing.join(', ')} (will use fallback multiplier)`,
      );
    }

    return {
      byCountry,
      source: this.source,
      dataYear: dataYear || new Date().getUTCFullYear() - 1,
    };
  }
}
