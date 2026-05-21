#!/usr/bin/env ts-node
/**
 * Monte-Carlo simulator for the crash-distribution engine.
 *
 * Usage (from the backend/ directory):
 *
 *   npx ts-node scripts/aviator/simulate-crash.ts \
 *     --rounds 100000 \
 *     --mode balanced \
 *     --rtp 0.96
 *
 *   npx ts-node scripts/aviator/simulate-crash.ts --rounds 1000000 --mode fast_loss
 *
 * Prints (a) the configured + analytic + realised RTP, (b) the
 * observed bucket histogram next to the analytic prediction, and (c)
 * variance / streak diagnostics.
 *
 * No DB or settings dependency — drives the pure-math engine
 * directly. Suitable for CI, local smoke, or operator pre-deploy
 * sanity-checking.
 */

import { generateServerSeed, deriveClientSeed } from '../../src/aviator/fairness';
import {
  BUCKET_EDGES,
  DEFAULT_PARAMS,
  DistributionParams,
  bucketProbabilities,
  clampParams,
  rtpBreakdown,
} from '../../src/aviator/crash/distribution';
import { computeHeavyTailCrash } from '../../src/aviator/crash/engine';
import { MODE_PRESETS, VolatilityMode } from '../../src/aviator/crash/modes';

interface CliArgs {
  rounds: number;
  mode: VolatilityMode;
  rtp: number;
  seed?: string;
  csv?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = 'true';
      }
    }
  }
  const modeRaw = (args.mode ?? 'balanced').toUpperCase();
  const mode: VolatilityMode = (
    modeRaw === 'FAST_LOSS' || modeRaw === 'STREAMER' ? modeRaw : 'BALANCED'
  ) as VolatilityMode;
  return {
    rounds: Number(args.rounds ?? 100_000),
    mode,
    rtp: Number(args.rtp ?? 0.96),
    seed: args.seed,
    csv: args.csv,
  };
}

function paramsForMode(mode: VolatilityMode, targetRtp: number): DistributionParams {
  const base = { ...(MODE_PRESETS[mode] ?? DEFAULT_PARAMS) };
  return clampParams({ ...base, rtp: targetRtp });
}

function bucketLabel(lo: number, hi: number): string {
  if (lo === 1.0 && hi === 1.2) return '<1.20';
  if (hi === Infinity) return `>=${lo.toFixed(2)}`;
  return `${lo.toFixed(2)}–${hi.toFixed(2)}`;
}

function pct(p: number): string {
  return `${(p * 100).toFixed(2)}%`;
}

function runSimulation(args: CliArgs): void {
  const params = paramsForMode(args.mode, args.rtp);
  console.log('Configuration');
  console.log('─────────────');
  console.log(`  Mode:           ${args.mode}`);
  console.log(`  Target RTP:     ${pct(args.rtp)}  (house edge ${pct(1 - args.rtp)})`);
  console.log(`  Rounds:         ${args.rounds.toLocaleString()}`);
  console.log(`  Params:         ${JSON.stringify(params)}`);

  const r = rtpBreakdown(params);
  console.log(`  Analytic RTP@${params.cRef.toFixed(1)}: ${pct(r.atRef)}`);
  console.log(`  Analytic RTP@1.2:  ${pct(r.atLow)}`);
  console.log(`  Analytic RTP@10:   ${pct(r.atHigh)}`);
  console.log('');

  // Deterministic seed material so the same CLI invocation reproduces
  // exactly. Operator can pass --seed to vary.
  const serverSeed = args.seed ?? generateServerSeed();
  const clientSeed = deriveClientSeed(null, 0);
  console.log('Seed material (reproducible):');
  console.log(`  serverSeed: ${serverSeed}`);
  console.log(`  clientSeed: ${clientSeed}`);
  console.log('');

  const edges = [1.0, ...BUCKET_EDGES, Infinity];
  const counts = new Array(edges.length - 1).fill(0);
  let sum = 0;
  let maxObserved = 1.0;
  let lossStreak = 0;
  let maxLossStreak = 0;
  let winStreak = 0;
  let maxWinStreak = 0;
  const csvLines: string[] = [];
  if (args.csv) csvLines.push('nonce,multiplier');

  const t0 = Date.now();
  for (let n = 1; n <= args.rounds; n++) {
    const m = computeHeavyTailCrash(serverSeed, clientSeed, n, params);
    sum += m;
    if (m > maxObserved) maxObserved = m;

    // Cash at 2x → "loss" = M < 2.0, "win" = M ≥ 2.0.
    if (m < 2.0) {
      lossStreak += 1;
      winStreak = 0;
      if (lossStreak > maxLossStreak) maxLossStreak = lossStreak;
    } else {
      winStreak += 1;
      lossStreak = 0;
      if (winStreak > maxWinStreak) maxWinStreak = winStreak;
    }

    for (let i = 0; i < edges.length - 1; i++) {
      if (m >= edges[i] && m < edges[i + 1]) {
        counts[i] += 1;
        break;
      }
    }
    if (args.csv) csvLines.push(`${n},${m.toFixed(2)}`);
  }
  const elapsed = (Date.now() - t0) / 1000;
  // Observed RTP at C_ref (strategy-invariant operator edge).
  // wins-above-C divided by total, scaled by C.
  let winsAtRef = 0;
  // Recompute (sum already aggregated; we need win count separately).
  // For efficiency we accumulate during sampling — patched above is
  // not used; instead the script tracks max + streaks and we infer
  // the "wins at ref" count here from the bucket counts above C_ref.
  // The first bucket fully above params.cRef:
  for (let i = 0; i < edges.length - 1; i++) {
    if (edges[i] >= params.cRef) winsAtRef += counts[i];
  }
  const observedRtpAtRef = (winsAtRef / args.rounds) * params.cRef;
  const observedMean = sum / args.rounds;

  console.log('Bucket histogram (observed vs analytic)');
  console.log('───────────────────────────────────────');
  const analyticBuckets = bucketProbabilities(params);
  console.log(
    `  ${'bucket'.padEnd(14)} ${'observed'.padStart(10)} ${'analytic'.padStart(10)} ${'delta'.padStart(8)}`,
  );
  for (let i = 0; i < edges.length - 1; i++) {
    const label = bucketLabel(edges[i], edges[i + 1]);
    const observed = counts[i] / args.rounds;
    const analyticP = analyticBuckets[i].probability;
    const delta = observed - analyticP;
    const sign = delta >= 0 ? '+' : '-';
    console.log(
      `  ${label.padEnd(14)} ${pct(observed).padStart(10)} ${pct(analyticP).padStart(10)} ${(sign + pct(Math.abs(delta))).padStart(8)}`,
    );
  }
  console.log('');

  console.log('RTP convergence (strategy-invariant: cash at C_ref)');
  console.log('────────────────────────────────────────────────────');
  console.log(`  Configured RTP:        ${pct(args.rtp)}`);
  console.log(`  Analytic RTP@${params.cRef.toFixed(1)}:    ${pct(r.atRef)}`);
  console.log(`  Observed RTP@${params.cRef.toFixed(1)}:    ${pct(observedRtpAtRef)}`);
  console.log(`  Drift:                 ${(observedRtpAtRef - args.rtp >= 0 ? '+' : '-') + pct(Math.abs(observedRtpAtRef - args.rtp))}`);
  console.log(`  E[M] (observed mean):  ${observedMean.toFixed(4)}`);
  console.log('');

  console.log('Volatility diagnostics');
  console.log('──────────────────────');
  console.log(`  Max observed multiplier:  ${maxObserved.toFixed(2)}x`);
  console.log(`  Longest losing streak (M<2):   ${maxLossStreak}`);
  console.log(`  Longest winning streak (M≥2):  ${maxWinStreak}`);
  console.log(`  Elapsed: ${elapsed.toFixed(2)}s — ${Math.round(args.rounds / Math.max(elapsed, 0.001)).toLocaleString()} rounds/s`);

  if (args.csv && csvLines.length) {
    const fs = require('fs') as typeof import('fs');
    fs.writeFileSync(args.csv, csvLines.join('\n'));
    console.log('');
    console.log(`Wrote ${csvLines.length - 1} rows to ${args.csv}`);
  }
}

const args = parseArgs(process.argv.slice(2));
runSimulation(args);
