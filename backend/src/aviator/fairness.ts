import { createHash, createHmac, randomBytes } from 'crypto';

/**
 * Provably-fair crash-multiplier derivation. Pure functions — no I/O.
 *
 * Algorithm (industry-standard for Aviator-style games):
 *   1. Server commits a 32-byte hex `serverSeed` and publishes its SHA-256
 *      hash before each round.
 *   2. A `clientSeed` is derived deterministically from prior round data
 *      (so the server can't bias rounds toward known cashout times).
 *   3. The round's crash point is
 *        H = HMAC_SHA256(serverSeed, "${clientSeed}:${nonce}")
 *        first 13 hex chars of H → integer e
 *        result = floor((100 * 2^52 - e) / (2^52 - e)) / 100
 *   4. A 1-in-33 house-edge slot collapses to `1.00` (insta-crash).
 *
 * After the round, `serverSeed` is revealed so anyone can recompute the
 * crash point from `(serverSeed, clientSeed, nonce)`.
 */

export function generateServerSeed(): string {
  return randomBytes(32).toString('hex');
}

export function hashServerSeed(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

/**
 * Deterministic client seed for round N. Mixing in the previous round's
 * server seed (revealed at its crash) plus its number means a fresh-server
 * cannot pre-commit to a specific crash sequence for already-published
 * rounds.
 */
export function deriveClientSeed(
  previousServerSeed: string | null,
  previousRoundNumber: number,
): string {
  const material = `${previousServerSeed ?? 'genesis'}:${previousRoundNumber}`;
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

/**
 * Compute the crash multiplier deterministically. Returns a number ≥ 1.00,
 * rounded down to 2 decimal places.
 */
export function computeCrashMultiplier(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): number {
  const hmac = createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest('hex');

  // 1-in-33 insta-crash (≈3% house edge).
  const houseEdgeHash = parseInt(hmac.slice(52, 56), 16);
  if (houseEdgeHash % 33 === 0) return 1.0;

  const e = parseInt(hmac.slice(0, 13), 16);
  const denom = Math.pow(2, 52);
  const result = Math.floor((100 * denom) / (denom - e)) / 100;
  return Math.max(1.0, result);
}

/** Multiplier curve given elapsed milliseconds since round start. */
export function multiplierAt(elapsedMs: number): number {
  if (elapsedMs <= 0) return 1.0;
  // 1.0024^(t*100) where t is seconds. ≈ 1.27× @1s, 3.30× @5s, 10.89× @10s.
  return Math.pow(1.0024, elapsedMs / 10);
}

/** Inverse of [multiplierAt]: elapsed ms when the multiplier hits `m`. */
export function timeForMultiplier(m: number): number {
  if (m <= 1.0) return 0;
  return (Math.log(m) / Math.log(1.0024)) * 10;
}
