import { Injectable, Logger } from '@nestjs/common';

/**
 * Forex provider abstraction.
 *
 * The pricing engine depends on this INTERFACE, not on any specific
 * upstream — so swapping exchangerate.host for Open Exchange Rates or
 * ECB is a one-class change with no engine edits (clean architecture,
 * dependency-inversion).
 *
 * Returns USD-base rates: `rates[CUR]` = how many units of CUR one USD
 * buys. The snapshot stores exactly this, frozen for the year.
 */
export interface ForexRates {
  /** ISO date the upstream rates correspond to (YYYY-MM-DD). */
  date: string;
  /** currency → units per 1 USD. Always includes USD: 1. */
  rates: Record<string, number>;
  /** Provider identifier for the snapshot's `forexSource` column. */
  source: string;
}

export abstract class ForexProvider {
  abstract fetchUsdRates(currencies: readonly string[]): Promise<ForexRates>;
}

/**
 * Open Exchange Rates' free OPEN endpoint (open.er-api.com).
 *
 * This is the DEFAULT provider because it needs no API key and covers
 * every currency we sell in (including NGN / AED / RUB that the ECB
 * list lacks). USD-base, daily refresh — perfect for the once-a-year
 * snapshot. exchangerate.host (below) is kept as an opt-in for
 * deployments that have a paid key, since the spec named it preferred.
 */
@Injectable()
export class OpenErApiForexProvider extends ForexProvider {
  private readonly logger = new Logger(OpenErApiForexProvider.name);
  readonly source = 'open.er-api.com';

  private readonly endpoint =
    process.env.OPEN_ER_API_URL ?? 'https://open.er-api.com/v6/latest/USD';

  async fetchUsdRates(currencies: readonly string[]): Promise<ForexRates> {
    const wanted = Array.from(new Set(['USD', ...currencies]));
    const res = await fetch(this.endpoint, {
      signal: AbortSignal.timeout(15_000),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`open.er-api.com HTTP ${res.status}`);
    const body = (await res.json()) as {
      result?: string;
      base_code?: string;
      time_last_update_utc?: string;
      rates?: Record<string, number>;
    };
    if (body.result !== 'success' || !body.rates) {
      throw new Error('open.er-api.com: response not successful');
    }

    const rates: Record<string, number> = { USD: 1 };
    for (const cur of wanted) {
      const v = body.rates[cur];
      if (Number.isFinite(v) && v > 0) rates[cur] = v;
    }
    const missing = wanted.filter((c) => rates[c] === undefined);
    if (missing.length > 0) {
      this.logger.warn(`open.er-api.com missing rates for: ${missing.join(', ')}`);
    }

    // The API returns a full RFC-1123 date string; reduce to YYYY-MM-DD.
    const date = body.time_last_update_utc
      ? new Date(body.time_last_update_utc).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    return { date, rates, source: this.source };
  }
}

/**
 * exchangerate.host implementation (the spec's preferred source).
 *
 * Endpoint: `https://api.exchangerate.host/live` (USD source) — free,
 * no auth for the basic tier. We request only the currencies we sell
 * in. Retry-safe: caller (the annual sync) wraps this in a retry, and
 * we apply a hard timeout so a hung upstream can't stall a deploy.
 */
@Injectable()
export class ExchangeRateHostProvider extends ForexProvider {
  private readonly logger = new Logger(ExchangeRateHostProvider.name);
  readonly source = 'exchangerate.host';

  // exchangerate.host /live returns keys like "USDINR"; the older
  // /latest returns a flat `rates` map. We support both shapes so a
  // tier/endpoint change upstream doesn't break parsing.
  private readonly endpoint =
    process.env.EXCHANGERATE_HOST_URL ?? 'https://api.exchangerate.host/live';

  async fetchUsdRates(currencies: readonly string[]): Promise<ForexRates> {
    const wanted = Array.from(new Set(['USD', ...currencies]));
    const url = new URL(this.endpoint);
    url.searchParams.set('source', 'USD');
    url.searchParams.set('currencies', wanted.join(','));
    const accessKey = process.env.EXCHANGERATE_HOST_KEY;
    if (accessKey) url.searchParams.set('access_key', accessKey);

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(15_000),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`exchangerate.host HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      success?: boolean;
      source?: string;
      quotes?: Record<string, number>; // "USDINR": 83.1
      rates?: Record<string, number>; // "INR": 83.1  (legacy /latest)
      date?: string;
      error?: { info?: string };
    };

    if (body.success === false) {
      throw new Error(
        `exchangerate.host error: ${body.error?.info ?? 'unknown'}`,
      );
    }

    const rates: Record<string, number> = { USD: 1 };
    if (body.quotes) {
      // /live shape — strip the "USD" prefix off each "USDINR" key.
      for (const [k, v] of Object.entries(body.quotes)) {
        const cur = k.startsWith('USD') ? k.slice(3) : k;
        if (Number.isFinite(v) && v > 0) rates[cur] = v;
      }
    } else if (body.rates) {
      for (const [cur, v] of Object.entries(body.rates)) {
        if (Number.isFinite(v) && v > 0) rates[cur] = v;
      }
    } else {
      throw new Error('exchangerate.host: response had neither quotes nor rates');
    }

    const missing = wanted.filter((c) => rates[c] === undefined);
    if (missing.length > 0) {
      this.logger.warn(
        `exchangerate.host missing rates for: ${missing.join(', ')}`,
      );
    }

    return {
      date: body.date ?? new Date().toISOString().slice(0, 10),
      rates,
      source: this.source,
    };
  }
}
