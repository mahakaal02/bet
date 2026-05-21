/**
 * Crash-engine helpers: provably-fair RNG → uniform → multiplier.
 *
 * This file is a thin glue layer between the existing HMAC-based
 * provably-fair primitives in `../fairness.ts` and the pure-math
 * distribution sampler in `./distribution.ts`.
 *
 * Importantly, this module DOES NOT replace `computeCrashMultiplier`
 * — that function is still in use, still verifiable, and still the
 * fallback when the heavy-tail engine is disabled. Keeping it intact
 * means every round committed under the existing seed/hash chain
 * remains verifiable byte-for-byte.
 */

import { createHmac } from 'crypto';
import {
  DistributionParams,
  sampleMultiplier,
  uniformFromHmacHex,
} from './distribution';

/**
 * Provably-fair domain separator. Mixed into the HMAC alongside
 * `clientSeed:nonce` so the heavy-tail engine and the legacy
 * `computeCrashMultiplier` cannot produce the same digest for the
 * same nonce — keeps the two algorithms cryptographically distinct
 * even if both are evaluated on the same seed chain.
 *
 * Constant byte-for-byte across the codebase so re-running tests +
 * audits is reproducible.
 */
export const HEAVY_TAIL_DOMAIN = 'aviator:crash-v1';

/**
 * The HMAC digest used by the heavy-tail engine. Auditors recompute
 * this exactly: `HMAC_SHA256(serverSeed, "${HEAVY_TAIL_DOMAIN}|${clientSeed}:${nonce}")`.
 */
export function deriveDigest(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): string {
  return createHmac('sha256', serverSeed)
    .update(`${HEAVY_TAIL_DOMAIN}|${clientSeed}:${nonce}`)
    .digest('hex');
}

/**
 * End-to-end: from the provably-fair seed triple + the chosen params,
 * derive the crash multiplier.
 *
 * Determinism: identical (serverSeed, clientSeed, nonce, params) →
 * identical output, indefinitely. Auditors and the simulation
 * harness rely on this.
 */
export function computeHeavyTailCrash(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  params: DistributionParams,
): number {
  const digest = deriveDigest(serverSeed, clientSeed, nonce);
  const u = uniformFromHmacHex(digest);
  return sampleMultiplier(u, params);
}

/**
 * Audit / replay helper. Returns the exact crash multiplier for the
 * given (seed, params) without touching any state — used by the
 * `/aviator/fairness/verify` route (if/when added) and by the
 * Monte-Carlo simulator.
 */
export function verifyCrash(input: {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  params: DistributionParams;
}): { multiplier: number; digest: string; u: number } {
  const digest = deriveDigest(input.serverSeed, input.clientSeed, input.nonce);
  const u = uniformFromHmacHex(digest);
  const multiplier = sampleMultiplier(u, input.params);
  return { multiplier, digest, u };
}
