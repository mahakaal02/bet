/**
 * Payout-cap pure helpers (PR-AVIATOR-PAYOUT-CAP).
 *
 * The payout cap is a per-bet settlement-side ceiling — fundamentally
 * different from `AviatorSettings.maxPayout`, which clips the crash
 * multiplier itself before the round even runs. Both can coexist:
 *
 *   • `AviatorSettings.maxPayout`  → affects the round (visible to all)
 *   • `aviator.payout_cap.*`        → affects one player's settlement
 *                                     (round still flies for everyone)
 *
 * These functions are intentionally pure (no I/O, no side effects) so
 * they're trivially unit-testable and safe to call from inside the
 * tight game-loop tick. The wiring into `AviatorService` lives in
 * `aviator.service.ts`; the loader function `loadCapConfig` takes a
 * `SettingsService` as input so this file can stay free of NestJS DI.
 *
 * Currency unit: integer coins (the Aviator wallet is 1 coin = 1 INR
 * on this platform — see `BetWalletService.credit`). No floats are
 * stored or compared; multiplication uses `Math.floor` to match
 * `cashoutInternal`'s existing convention.
 */

import { SettingType } from '@prisma/client';

/** Default cap value when the SystemSetting row is missing or null. */
export const DEFAULT_PAYOUT_CAP_COINS = 20_000;

/** Default enabled state when the SystemSetting row is missing. */
export const DEFAULT_PAYOUT_CAP_ENABLED = true;

/** Dotted SystemSetting keys (env-var equivalents: SHOUTING_SNAKE). */
export const PAYOUT_CAP_KEY_ENABLED = 'aviator.payout_cap.enabled';
export const PAYOUT_CAP_KEY_MAX_COINS = 'aviator.payout_cap.max_coins';

/**
 * Immutable cap snapshot. Captured once per round in
 * `startBettingPhase` so admins changing the cap mid-round can't
 * surprise an already-running bet. Same pattern the existing
 * `forcedNextPayout` / `maxPayout` knobs use.
 */
export interface PayoutCapConfig {
  enabled: boolean;
  /**
   * Cap in integer coins. Always positive when `enabled` is true.
   * When `enabled === false` this can be any value and is ignored.
   * `MAX_SAFE_INTEGER` sentinel is used for "effectively no cap" in
   * a few helpers; downstream code MUST gate on `enabled` first
   * before using this number.
   */
  maxCoins: number;
}

/** What `applyPayoutCap` returns. All fields are integer coins. */
export interface PayoutCapResult {
  /**
   * Coins actually credited to the player's wallet. Always
   * floor()-ed and clamped at `maxCoins` when the cap fires.
   */
  payout: number;
  /**
   * Coins the player would have received without the cap. Same
   * value as `payout` when no cap fired, so admin queries don't
   * need to special-case the un-capped path.
   */
  originalPayout: number;
  /**
   * True iff the cap fired. Persisted on `AviatorBet.cappedByPayoutCap`
   * + included on the `PLAYER_CASHOUT` socket event as an OPTIONAL
   * field so old clients keep working.
   */
  capped: boolean;
  /**
   * The cap value snapshot at the time of settlement. Persisted on
   * `AviatorBet.payoutCapCoins` so a dispute can reproduce the
   * applied cap from cold even after the admin changes the value.
   * Null when `capped === false` AND the cap was disabled, so
   * historical un-capped rows stay null (no schema noise).
   */
  appliedCapCoins: number | null;
}

/**
 * Settle a bet's payout against the configured cap. Integer math
 * throughout — no float drift even at 1M× multipliers.
 *
 * Floor convention matches `cashoutInternal`'s
 * `Math.floor(new Decimal(amount).times(multiplier).toNumber())` so
 * the un-capped path is byte-identical to the legacy behaviour.
 *
 * @param stake      The bet's stake in coins (positive integer).
 * @param multiplier The cashout multiplier (e.g. 2.45, 500.00).
 * @param config     Per-round cap snapshot.
 */
export function applyPayoutCap(
  stake: number,
  multiplier: number,
  config: PayoutCapConfig,
): PayoutCapResult {
  // Defensive — same invariants `cashoutInternal` already relies on.
  // If anything upstream gave us garbage, treat it as a no-cap pass-
  // through with a 0 payout (which matches Bet wallet's reaction to
  // a failed credit) rather than throw inside the game loop.
  if (!Number.isFinite(stake) || stake <= 0) {
    return { payout: 0, originalPayout: 0, capped: false, appliedCapCoins: null };
  }
  if (!Number.isFinite(multiplier) || multiplier < 1) {
    return { payout: 0, originalPayout: 0, capped: false, appliedCapCoins: null };
  }

  // Same floor convention as the existing cashout path. We intentionally
  // do NOT use Decimal here because the upstream call site already
  // converted `multiplier` to a JS number — bringing Decimal back in
  // would risk a different rounding profile for capped vs un-capped
  // bets, which is exactly the kind of drift the cap is supposed to
  // PREVENT.
  const raw = Math.floor(stake * multiplier);

  // Cap disabled, missing config, or non-positive — pass through.
  if (!isCapActive(config)) {
    return {
      payout: raw,
      originalPayout: raw,
      capped: false,
      appliedCapCoins: null,
    };
  }

  if (raw <= config.maxCoins) {
    return {
      payout: raw,
      originalPayout: raw,
      capped: false,
      // We DO record the cap that was in force even on un-capped
      // wins, so a subsequent audit "did this user benefit from
      // the cap being disabled mid-round?" is answerable. Cheap
      // — single integer column.
      appliedCapCoins: config.maxCoins,
    };
  }

  return {
    payout: config.maxCoins,
    originalPayout: raw,
    capped: true,
    appliedCapCoins: config.maxCoins,
  };
}

/**
 * Returns the exact multiplier at which a bet of `stake` coins
 * would hit `capCoins` coins. Used by the tick loop to fire an
 * auto-cashout the moment the live multiplier crosses this line.
 *
 * `Number.POSITIVE_INFINITY` for stake <= 0 or cap <= 0 — those
 * cases should never trigger an auto-cashout.
 */
export function capMultiplier(stake: number, capCoins: number): number {
  if (!Number.isFinite(stake) || stake <= 0) return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(capCoins) || capCoins <= 0) return Number.POSITIVE_INFINITY;
  return capCoins / stake;
}

/**
 * Predicate: is the cap currently effective? A cap with `enabled:
 * false`, `maxCoins <= 0`, `NaN`, or `Infinity` is treated as no-op.
 * Keeping this in one place means callers can't forget one of the
 * checks.
 */
export function isCapActive(config: PayoutCapConfig): boolean {
  return (
    config.enabled === true &&
    Number.isFinite(config.maxCoins) &&
    config.maxCoins > 0
  );
}

/** Minimal subset of `SettingsService` this loader depends on. */
export interface SettingsReader {
  getBool(key: string, fallback: boolean): Promise<boolean>;
  getInt(key: string, fallback: number): Promise<number>;
}

/**
 * Resolve the cap config from `SettingsService` with safe fallbacks.
 * Called once per round at `startBettingPhase`. Cross-pod hot-reload
 * lag is bounded by the SettingsService TTL (60 s).
 *
 * If the operator persists a non-positive or non-finite `maxCoins`
 * value, we coerce to the default rather than disabling the cap —
 * a misconfigured row should fail SAFE (keep the cap on with a
 * sensible value), not unsafe (silently turn the cap off).
 */
export async function loadCapConfig(
  settings: SettingsReader,
): Promise<PayoutCapConfig> {
  const enabled = await settings.getBool(
    PAYOUT_CAP_KEY_ENABLED,
    DEFAULT_PAYOUT_CAP_ENABLED,
  );
  const rawMax = await settings.getInt(
    PAYOUT_CAP_KEY_MAX_COINS,
    DEFAULT_PAYOUT_CAP_COINS,
  );
  const maxCoins =
    Number.isFinite(rawMax) && rawMax > 0
      ? Math.floor(rawMax)
      : DEFAULT_PAYOUT_CAP_COINS;
  return { enabled, maxCoins };
}

/**
 * Exposed for the admin controller so it can persist the canonical
 * (key, valueType) tuple via `SettingsService.set()` without
 * duplicating the type metadata.
 */
export const PAYOUT_CAP_SETTING_TYPES = {
  [PAYOUT_CAP_KEY_ENABLED]: SettingType.BOOL,
  [PAYOUT_CAP_KEY_MAX_COINS]: SettingType.INT,
} as const;
