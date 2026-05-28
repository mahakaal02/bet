import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, PricingSnapshotStatus } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ForexProvider } from './providers/forex.provider';
import { PppProvider } from './providers/ppp.provider';
import { PricingEngine } from './pricing-engine.service';
import { suggestStoreTier } from './app-store-mapping';
import {
  BASELINE_COUNTRY,
  COUNTRY_BY_CODE,
  COUNTRY_CATALOG,
  SUPPORTED_COUNTRIES,
  SUPPORTED_CURRENCIES,
} from './pricing.config';
import type { ResolvedCountry } from './country-detection.service';

/**
 * Pricing orchestration — owns the once-a-year sync, the public
 * pricing read (with Redis cache + fallback), and the admin CRUD over
 * snapshots/rows. Pure math lives in PricingEngine; I/O (HTTP, DB,
 * cache) lives here.
 */

export interface SyncOptions {
  /** Calendar year the snapshot is effective for. Defaults to the
   *  current UTC year. */
  year?: number;
  /** Admin user id for a manual run; undefined = cron. */
  generatedBy?: string;
  /** Publish immediately (deactivate prior, serve this). Default true
   *  for the cron; admins can generate a DRAFT first by passing false. */
  publish?: boolean;
}

export interface SyncResult {
  snapshotId: string;
  effectiveYear: number;
  status: PricingSnapshotStatus;
  countries: number;
  packs: number;
  rows: number;
  flaggedCountries: string[];
  forexSource: string;
  pppSource: string;
}

const CACHE_PREFIX = 'pricing:current:';
// Prices change once a year — cache aggressively. 7 days; a publish
// busts it explicitly so a new snapshot is visible immediately.
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly forex: ForexProvider,
    private readonly ppp: PppProvider,
    private readonly engine: PricingEngine,
  ) {}

  // ───────────────────────────── ANNUAL SYNC ─────────────────────────────

  /**
   * Generate (and optionally publish) the pricing snapshot for a year.
   *
   * IDEMPOTENT: keyed on `effectiveYear` — re-running the same year
   * replaces that year's snapshot wholesale inside one transaction, so
   * a retry after a partial failure converges to the same end state.
   *
   * RETRY-SAFE: forex + PPP fetches are wrapped in a bounded retry; a
   * Redis advisory lock prevents two cron ticks / a cron + a manual
   * trigger from racing.
   */
  async runAnnualPricingSync(opts: SyncOptions = {}): Promise<SyncResult> {
    const year = opts.year ?? new Date().getUTCFullYear();
    const publish = opts.publish ?? true;

    const result = await this.redis.withLock(
      `pricing-sync:${year}`,
      120_000,
      () => this.doSync(year, publish, opts.generatedBy),
    );
    if (result === null) {
      throw new Error(
        `pricing sync for ${year} already running (lock held) — try again shortly`,
      );
    }
    return result;
  }

  private async doSync(
    year: number,
    publish: boolean,
    generatedBy?: string,
  ): Promise<SyncResult> {
    this.logger.log(`annual pricing sync starting for ${year} (publish=${publish})`);

    // 1. Coin packs that have a USD anchor — the only ones we can PPP.
    const packs = await this.prisma.coinPack.findMany({
      where: { active: true, baseUsdPrice: { not: null } },
      orderBy: [{ sortOrder: 'asc' }, { coins: 'asc' }],
    });
    if (packs.length === 0) {
      throw new Error(
        'no active coin packs with a baseUsdPrice — set base USD prices before syncing',
      );
    }

    // 2. Fetch forex + PPP with retry.
    const forex = await this.withRetry('forex', () =>
      this.forex.fetchUsdRates(SUPPORTED_CURRENCIES),
    );
    const ppp = await this.withRetry('ppp', () =>
      this.ppp.fetchPppData(SUPPORTED_COUNTRIES),
    );

    // 3. Normalize multipliers against the baseline.
    const normalized = this.engine.normalizeMultipliers(
      ppp.byCountry,
      SUPPORTED_COUNTRIES,
      BASELINE_COUNTRY,
    );
    const multByCountry = new Map(normalized.map((n) => [n.country, n]));
    const flaggedCountries = normalized
      .filter((n) => n.isFallback)
      .map((n) => n.country);

    // 4. Build all rows in memory (pure), then persist in ONE
    //    transaction so the snapshot is all-or-nothing.
    const written = await this.prisma.$transaction(async (tx) => {
      // Replace any existing snapshot for this year (idempotent re-run).
      const existing = await tx.pricingSnapshot.findUnique({
        where: { effectiveYear: year },
      });
      if (existing) {
        await tx.pricingSnapshot.delete({ where: { id: existing.id } });
      }

      const snapshot = await tx.pricingSnapshot.create({
        data: {
          effectiveYear: year,
          status: publish
            ? PricingSnapshotStatus.PUBLISHED
            : PricingSnapshotStatus.DRAFT,
          isActive: publish,
          baselineCountry: BASELINE_COUNTRY,
          forexSource: forex.source,
          pppSource: ppp.source,
          generatedBy: generatedBy ?? null,
          notes: `forex ${forex.date}, ppp vintage ${ppp.dataYear}`,
        },
      });

      // Forex + PPP factor snapshots (for admin display + audit).
      await tx.forexRateSnapshot.createMany({
        data: SUPPORTED_CURRENCIES.filter((c) => forex.rates[c] != null).map(
          (currencyCode) => ({
            snapshotId: snapshot.id,
            effectiveYear: year,
            currencyCode,
            usdRate: new Prisma.Decimal(forex.rates[currencyCode]),
            source: forex.source,
          }),
        ),
      });
      await tx.pppFactorSnapshot.createMany({
        data: normalized.map((n) => ({
          snapshotId: snapshot.id,
          effectiveYear: year,
          countryCode: n.country,
          rawPppValue: n.rawValue != null ? new Prisma.Decimal(n.rawValue) : null,
          normalizedMultiplier: new Prisma.Decimal(n.multiplier),
          source: ppp.source,
          isFallback: n.isFallback,
        })),
      });

      // Regional pricing rows — one per (pack × country).
      const rows: Prisma.RegionalCoinPricingCreateManyInput[] = [];
      for (const pack of packs) {
        const baseUsd = pack.baseUsdPrice!; // filtered non-null above
        for (const cfg of COUNTRY_CATALOG) {
          const mult = multByCountry.get(cfg.country)!;
          const rate = forex.rates[cfg.currency];
          if (rate == null) {
            this.logger.warn(
              `skipping ${cfg.country}/${pack.coins} — no forex rate for ${cfg.currency}`,
            );
            continue;
          }
          const priced = this.engine.priceRow({
            country: cfg.country,
            baseUsdPrice: baseUsd,
            multiplier: mult.multiplier,
            usdRate: rate,
          });
          rows.push({
            snapshotId: snapshot.id,
            coinPackId: pack.id,
            countryCode: cfg.country,
            currencyCode: cfg.currency,
            baseUsdPrice: new Prisma.Decimal(priced.baseUsdPrice),
            forexRate: new Prisma.Decimal(priced.forexRate),
            pppMultiplier: new Prisma.Decimal(priced.pppMultiplier),
            calculatedLocalPrice: new Prisma.Decimal(priced.calculatedLocalPrice),
            roundedFinalPrice: new Prisma.Decimal(priced.roundedFinalPrice),
            effectiveYear: year,
            sourceExchangeRate: `${forex.source}@${forex.date}`,
            sourcePppData: `${ppp.source}@${ppp.dataYear}`,
            isActive: publish,
          });
        }
      }
      await tx.regionalCoinPricing.createMany({ data: rows });

      // 5. On publish: demote every OTHER snapshot + its rows.
      if (publish) {
        await tx.pricingSnapshot.updateMany({
          where: { id: { not: snapshot.id }, isActive: true },
          data: { isActive: false, status: PricingSnapshotStatus.ARCHIVED },
        });
        await tx.regionalCoinPricing.updateMany({
          where: { snapshotId: { not: snapshot.id }, isActive: true },
          data: { isActive: false },
        });
      }

      return { snapshot, rowCount: rows.length };
    });

    // 6. Bust the public cache so the new prices serve immediately.
    if (publish) await this.invalidateCache();

    this.logger.log(
      `pricing sync ${year} done: ${written.rowCount} rows across ` +
        `${COUNTRY_CATALOG.length} countries × ${packs.length} packs` +
        (flaggedCountries.length
          ? ` (flagged: ${flaggedCountries.join(', ')})`
          : ''),
    );

    return {
      snapshotId: written.snapshot.id,
      effectiveYear: year,
      status: written.snapshot.status,
      countries: COUNTRY_CATALOG.length,
      packs: packs.length,
      rows: written.rowCount,
      flaggedCountries,
      forexSource: forex.source,
      pppSource: ppp.source,
    };
  }

  // ───────────────────────────── PUBLIC READ ─────────────────────────────

  /**
   * Localized coin-pack prices for a resolved country. Cache-first
   * (Redis, 7-day TTL), with a USD→nearest-region→USD fallback chain
   * already applied by CountryDetectionService, plus a final in-DB
   * fallback to the baseline country if the resolved country somehow
   * has no rows (e.g. added to the catalog after the last sync).
   */
  async getCurrentPricing(resolved: ResolvedCountry) {
    const cacheKey = `${CACHE_PREFIX}${resolved.country}`;
    const cached = await this.redis.io
      .get(cacheKey)
      .catch(() => null);
    if (cached) {
      const parsed = JSON.parse(cached);
      return { ...parsed, country: resolved.country, currency: resolved.currency, source: resolved.source, usedFallback: resolved.usedFallback };
    }

    const active = await this.prisma.pricingSnapshot.findFirst({
      where: { isActive: true, status: PricingSnapshotStatus.PUBLISHED },
      orderBy: { effectiveYear: 'desc' },
    });
    if (!active) {
      // No pricing has ever been published — surface USD base prices
      // directly so the storefront still works pre-first-sync.
      return this.rawUsdFallback(resolved);
    }

    let rows = await this.prisma.regionalCoinPricing.findMany({
      where: { snapshotId: active.id, countryCode: resolved.country },
      include: { coinPack: true },
      orderBy: { coinPack: { coins: 'asc' } },
    });

    let servedCountry = resolved.country;
    let usedFallback = resolved.usedFallback;
    if (rows.length === 0) {
      // Country in catalog but missing from snapshot → baseline.
      rows = await this.prisma.regionalCoinPricing.findMany({
        where: { snapshotId: active.id, countryCode: BASELINE_COUNTRY },
        include: { coinPack: true },
        orderBy: { coinPack: { coins: 'asc' } },
      });
      servedCountry = BASELINE_COUNTRY;
      usedFallback = true;
    }

    const cfg = COUNTRY_BY_CODE.get(servedCountry)!;
    const payload = {
      effectiveYear: active.effectiveYear,
      country: resolved.country,
      currency: resolved.usedFallback ? resolved.currency : cfg.currency,
      packs: rows.map((r) => ({
        coinPackId: r.coinPackId,
        coins: r.coinPack.coins,
        sku: r.coinPack.sku,
        currency: r.currencyCode,
        price: r.roundedFinalPrice.toString(),
        // NB: we intentionally do NOT expose forexRate / pppMultiplier
        // / baseUsdPrice here — the business rules forbid surfacing
        // direct fiat equivalence. Those live in the admin API only.
      })),
    };

    // Cache the country-keyed payload (without the per-request source flags).
    await this.redis.io
      .set(cacheKey, JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS)
      .catch(() => undefined);

    return { ...payload, source: resolved.source, usedFallback };
  }

  /**
   * Pre-first-sync / no-published-snapshot fallback: derive a charm-99
   * USD price straight from the pack's baseUsdPrice so the store still
   * has something to show. Not cached (transient state).
   */
  private async rawUsdFallback(resolved: ResolvedCountry) {
    const packs = await this.prisma.coinPack.findMany({
      where: { active: true, baseUsdPrice: { not: null } },
      orderBy: [{ sortOrder: 'asc' }, { coins: 'asc' }],
    });
    return {
      effectiveYear: new Date().getUTCFullYear(),
      country: resolved.country,
      currency: 'USD',
      source: resolved.source,
      usedFallback: true,
      packs: packs.map((p) => ({
        coinPackId: p.id,
        coins: p.coins,
        sku: p.sku,
        currency: 'USD',
        price: new Decimal(p.baseUsdPrice!.toString()).toFixed(2),
      })),
    };
  }

  // ───────────────────────────── ADMIN READ ──────────────────────────────

  /**
   * LIVE preview of every active pack's local price for one country —
   * for the coin-packs admin. Unlike `getCurrentPricing` (which reads
   * the frozen, published RegionalCoinPricing rows), this recomputes
   * from each pack's CURRENT `baseUsdPrice` using the active snapshot's
   * forex rate + PPP multiplier. So a just-added or just-edited pack
   * shows its converted price immediately, before any sync runs.
   *
   * No published snapshot yet → returns the raw USD anchors so the
   * admin still sees something. Not cached, not rate-limited.
   */
  async previewLocalPrices(countryCode: string) {
    const cc = (countryCode || BASELINE_COUNTRY).toUpperCase();
    const cfg = COUNTRY_BY_CODE.get(cc) ?? COUNTRY_BY_CODE.get(BASELINE_COUNTRY)!;

    const packs = await this.prisma.coinPack.findMany({
      where: { active: true, baseUsdPrice: { not: null } },
      orderBy: [{ sortOrder: 'asc' }, { coins: 'asc' }],
    });

    const active = await this.prisma.pricingSnapshot.findFirst({
      where: { isActive: true, status: PricingSnapshotStatus.PUBLISHED },
      orderBy: { effectiveYear: 'desc' },
    });

    if (!active) {
      return {
        country: cfg.country,
        currency: 'USD',
        hasSnapshot: false,
        packs: packs.map((p) => ({
          coinPackId: p.id,
          coins: p.coins,
          currency: 'USD',
          price: new Decimal(p.baseUsdPrice!.toString()).toFixed(2),
        })),
      };
    }

    const [forexRow, pppRow] = await Promise.all([
      this.prisma.forexRateSnapshot.findFirst({
        where: { snapshotId: active.id, currencyCode: cfg.currency },
      }),
      this.prisma.pppFactorSnapshot.findFirst({
        where: { snapshotId: active.id, countryCode: cfg.country },
      }),
    ]);
    // Baseline (US) is multiplier 1 / rate 1; anything missing from the
    // snapshot degrades to the same so the preview never blanks out.
    const usdRate = forexRow ? forexRow.usdRate.toString() : '1';
    const multiplier = pppRow ? Number(pppRow.normalizedMultiplier) : 1;

    return {
      country: cfg.country,
      currency: cfg.currency,
      hasSnapshot: true,
      effectiveYear: active.effectiveYear,
      packs: packs.map((p) => {
        const priced = this.engine.priceRow({
          country: cfg.country,
          baseUsdPrice: p.baseUsdPrice!.toString(),
          multiplier,
          usdRate,
        });
        return {
          coinPackId: p.id,
          coins: p.coins,
          currency: cfg.currency,
          price: priced.roundedFinalPrice,
        };
      }),
    };
  }

  /** All snapshots (newest first) for the admin history view. */
  listSnapshots() {
    return this.prisma.pricingSnapshot.findMany({
      orderBy: [{ effectiveYear: 'desc' }, { generatedAt: 'desc' }],
      include: { _count: { select: { rows: true } } },
    });
  }

  /** Full detail of one snapshot: rows + forex + ppp, with app-store
   *  tier suggestions computed on the fly for the admin table. */
  async getSnapshotDetail(snapshotId: string) {
    const snapshot = await this.prisma.pricingSnapshot.findUnique({
      where: { id: snapshotId },
      include: {
        forexRates: { orderBy: { currencyCode: 'asc' } },
        pppFactors: { orderBy: { countryCode: 'asc' } },
        rows: {
          include: { coinPack: true },
          orderBy: [{ countryCode: 'asc' }, { coinPack: { coins: 'asc' } }],
        },
      },
    });
    if (!snapshot) throw new NotFoundException('pricing snapshot not found');

    return {
      ...snapshot,
      rows: snapshot.rows.map((r) => {
        const cfg = COUNTRY_BY_CODE.get(r.countryCode);
        const tier = suggestStoreTier(
          r.roundedFinalPrice.toString(),
          cfg?.fractionDigits ?? 2,
        );
        return { ...r, appStoreTier: tier };
      }),
    };
  }

  /**
   * Admin override of a single computed price. Lets ops nudge a market
   * (e.g. round ₹39 → ₹49) without re-running the whole sync. Re-busts
   * the cache for that country.
   */
  async overrideRowPrice(rowId: string, roundedFinalPrice: string) {
    const row = await this.prisma.regionalCoinPricing.update({
      where: { id: rowId },
      data: { roundedFinalPrice: new Prisma.Decimal(roundedFinalPrice) },
    });
    await this.redis.io
      .del(`${CACHE_PREFIX}${row.countryCode}`)
      .catch(() => undefined);
    return row;
  }

  /** Admin override of a PPP multiplier on a DRAFT snapshot, with no
   *  re-fetch — useful when upstream data is missing/absurd for a
   *  market. Does NOT recompute rows (admin re-runs sync to apply). */
  async overridePppMultiplier(factorId: string, multiplier: string) {
    return this.prisma.pppFactorSnapshot.update({
      where: { id: factorId },
      data: {
        normalizedMultiplier: new Prisma.Decimal(multiplier),
        isFallback: false,
      },
    });
  }

  /** Publish a DRAFT snapshot: activate it, archive the rest. */
  async publishSnapshot(snapshotId: string) {
    const snapshot = await this.prisma.pricingSnapshot.findUnique({
      where: { id: snapshotId },
    });
    if (!snapshot) throw new NotFoundException('pricing snapshot not found');

    await this.prisma.$transaction([
      this.prisma.pricingSnapshot.updateMany({
        where: { isActive: true },
        data: { isActive: false, status: PricingSnapshotStatus.ARCHIVED },
      }),
      this.prisma.regionalCoinPricing.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      }),
      this.prisma.pricingSnapshot.update({
        where: { id: snapshotId },
        data: { isActive: true, status: PricingSnapshotStatus.PUBLISHED },
      }),
      this.prisma.regionalCoinPricing.updateMany({
        where: { snapshotId },
        data: { isActive: true },
      }),
    ]);
    await this.invalidateCache();
    return { ok: true, snapshotId, effectiveYear: snapshot.effectiveYear };
  }

  // ─────────────────────────────── HELPERS ───────────────────────────────

  private async invalidateCache() {
    // Delete every country-keyed entry. SCAN avoids blocking Redis on
    // a big keyspace; falls back silently if Redis is down.
    try {
      const stream = this.redis.io.scanStream({
        match: `${CACHE_PREFIX}*`,
        count: 100,
      });
      const keys: string[] = [];
      for await (const batch of stream) keys.push(...(batch as string[]));
      if (keys.length) await this.redis.io.del(...keys);
    } catch {
      /* Redis unavailable — entries simply expire via TTL. */
    }
  }

  /** Bounded retry with linear backoff. Forex/PPP upstreams flap; one
   *  failed fetch shouldn't abort the annual run. */
  private async withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const delays = [1_000, 3_000, 8_000];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (attempt === delays.length) break;
        this.logger.warn(
          `${label} fetch failed (attempt ${attempt + 1}); retrying in ${delays[attempt]}ms: ${(err as Error).message}`,
        );
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
    }
    throw new Error(
      `${label} fetch failed after retries: ${(lastErr as Error)?.message}`,
    );
  }
}
