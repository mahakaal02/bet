# Aviator Crash Distribution Engine

Configurable, provably-fair, heavy-tail crash-multiplier engine for the
Aviator round lifecycle. **Disabled by default** — flip
`aviator.crash.engine=heavytail` (via `SystemSetting` row or
`AVIATOR_CRASH_ENGINE=heavytail` env var) to enable.

When disabled the existing [`fairness.ts`](../backend/src/aviator/fairness.ts)
implementation runs unchanged; every committed seed remains
byte-for-byte verifiable. The new engine ships behind a flag so the
legacy audit chain is never invalidated by a deploy.

---

## Table of contents

- [Why this exists](#why-this-exists)
- [Mathematical model](#mathematical-model)
  - [RTP semantics](#rtp-semantics)
  - [Distribution params](#distribution-params)
  - [Sampling — inverse CDF](#sampling--inverse-cdf)
  - [Tail amplitude derivation](#tail-amplitude-derivation)
- [Volatility modes](#volatility-modes)
- [Adaptive exposure system](#adaptive-exposure-system)
- [Provably-fair RNG](#provably-fair-rng)
- [Files added / modified](#files-added--modified)
- [Configuration](#configuration)
- [Integration with the round lifecycle](#integration-with-the-round-lifecycle)
- [Logging + auditability](#logging--auditability)
- [Migration steps](#migration-steps)
- [Example output distributions](#example-output-distributions)
- [Verifying a crash from cold](#verifying-a-crash-from-cold)
- [Tests + simulator](#tests--simulator)
- [Known design trade-offs](#known-design-trade-offs)

---

## Why this exists

The existing [`computeCrashMultiplier`](../backend/src/aviator/fairness.ts)
hard-codes a 1-in-33 insta-crash (≈3% house edge) + a `1/x` heavy tail.
That's a perfectly serviceable crash distribution — and was preserved
unchanged. What the new engine adds:

1. **Configurable RTP** (94–99%) without redeploying.
2. **Volatility modes** (`BALANCED` / `FAST_LOSS` / `STREAMER`) that
   shift histogram shape without changing the strategy-invariant
   operator edge.
3. **Adaptive exposure system** — smoothly blends modes based on a
   rolling EMA of round-level stake, so the house auto-protects in
   high-stake conditions and gives bigger jackpot moments when traffic
   is quiet.
4. **Bucket calibration** matching the player-psychology brief
   (`Crash Game Probability Model and House Edge.pdf` + `Executive
   Summary.docx`): more "near-misses" + heavier low band for engagement.
5. **Mathematically auditable RTP-at-C_ref invariant** — the published
   RTP is structurally locked at the canonical cashout regardless of
   mode blend.
6. **Reproducible audit trail** — every round logs the seed, mode,
   exposure factor, and a `paramsHash` so any auditor can replay the
   round from cold.

The engine **does not** change websocket events, REST endpoints,
the `AviatorRound.crashMultiplier` column type, or the
`BETTING → RUNNING → CRASHED` phase enum.

---

## Mathematical model

### RTP semantics

For a crash game, "RTP" is the expected payout per unit stake **at a
canonical cashout strategy `C_ref`**. Players who auto-cash at exactly
`C_ref` see long-run return = RTP × stake. The operator's edge is
`1 - RTP`.

For any cashout `C >= 1`:

```
expected_return(C) = C × P(M >= C)
```

When `P(M >= x) = RTP / x` (the canonical 1/x crash curve), this gives
`expected_return(C) = RTP` for **every** `C` — strategy-invariant
operator edge. This is what real crash games (Bustabit, Stake) target.

The engine **structurally locks** RTP at `C_ref` (default `2.0×`) so
the published edge holds regardless of mode blending. See
[`tailAlpha`](../backend/src/aviator/crash/distribution.ts) for the
derivation.

### Distribution params

```typescript
interface DistributionParams {
  rtp: number;          // 0.94 – 0.99    — house edge = 1 - rtp
  bias: number;         // 0   – 0.5      — extra mass in [1, biasUpper)
  biasUpper: number;    // 1.05 – 5       — upper edge of bias band
  k: number;            // 0.7  – 2.0     — tail exponent (1.0 = canonical 1/x)
  cRef: number;         // 1.05 – 10      — canonical cashout for RTP-lock
  maxMultiplier: number;// 10   – 1M      — hard ceiling
}
```

All knobs clamp to `PARAM_BOUNDS` before sampling — a misconfigured
`SystemSetting` row can never break the game loop.

### Sampling — inverse CDF

Three-region piecewise mixture, evaluated from a uniform `u ∈ [0, 1)`:

```
q = (1 - rtp) × (1 - bias)              # insta-crash mass

if u < q:                                # Region 1 — insta-crash
    M = 1.00

elif u < q + bias:                       # Region 2 — bias band (uniform)
    v = (u - q) / bias                   #   v ∈ [0, 1)
    M = 1 + v × (biasUpper - 1)

else:                                    # Region 3 — heavy tail (Pareto)
    v = (u - q - bias) / (1 - q - bias)  #   v ∈ [0, 1)
    M = (alpha / (1 - v))^(1/k)
    M = min(M, maxMultiplier)
```

The result is floored to 2 decimal places (matches the
`Decimal(10,2)` column on `AviatorRound`).

### Tail amplitude derivation

The Pareto tail's amplitude `alpha` is chosen so that
`C_ref × P(M >= C_ref) = RTP` holds exactly.

```
P(M >= C_ref) = (1 - q - bias) × α / C_ref^k     # for C_ref >= biasUpper

→  C_ref × (1 - q - bias) × α / C_ref^k = RTP
→  α = RTP × C_ref^(k - 1) / (1 - q - bias)
```

For `k = 1` this collapses to the canonical Bustabit formula
`α = RTP / tailMass`, recovering the legacy 1/x curve as a special
case.

---

## Volatility modes

Each mode publishes the **same** `rtp` and `cRef` — the operator's
edge is mode-invariant. Only `bias`, `biasUpper`, `k`, and
`maxMultiplier` shift.

| Mode | bias | biasUpper | k | maxMultiplier | Effect |
|------|-----:|----------:|--:|--------------:|--------|
| `BALANCED`   | 0.18 | 1.50 | 1.00 | 10 000 | Canonical 1/x + moderate near-miss band |
| `FAST_LOSS`  | 0.30 | 1.50 | 1.20 |  1 000 | Heavier low band, thinner tail (house-protection) |
| `STREAMER`   | 0.08 | 1.50 | 0.85 | 10 000 | Lighter low band, fatter tail (screenshot moments) |

All three modes are calibrated so that:

- Operator RTP-at-C_ref = configured `rtp` exactly.
- The 100k Monte-Carlo realised RTP is within ±0.3pp of the analytic
  target.

---

## Adaptive exposure system

The `ExposureTracker` is a per-process EMA of round-level stake,
payout, and bettor count. After each finished round, the service calls
`observeRoundOutcome({ stake, payout, bettors })`; before each new
round it asks for `exposureFactor() ∈ [-1, 1]`:

```
ratio   = smoothedStake / referenceStake
factor  = tanh(log2(ratio) / 2) × blendStrength
```

`tanh` is bounded ± 1 and symmetric in log-space — doubling vs halving
the stake produces equal-magnitude opposite factors. A small
RTP-drift correction (`rtpDriftFactor`) layers on top so that if the
realised payout drifts above the target for ≥50 rounds, the factor
nudges toward FAST_LOSS, and vice-versa.

The blended params come from `adaptiveParams(base, factor)`:

```
factor < 0  →  blend BALANCED toward STREAMER  (low exposure)
factor = 0  →  pure BALANCED
factor > 0  →  blend BALANCED toward FAST_LOSS (high exposure)
```

Blending is linear on `bias`, `biasUpper`, `k`; `rtp` and `cRef` are
held constant so the operator-facing edge never shifts due to
exposure adaptation.

**Anti-pattern guards:**
- `alpha = 0.20` EMA decay → ~20-round half-life. No single round
  can flip the mode.
- `blendStrength = 0.20` caps each round's factor magnitude.
- The drift-correction nudge is bounded to ±0.10.

---

## Provably-fair RNG

The engine reuses the existing
[`fairness-store.ts`](../backend/src/aviator/fairness-store.ts) seed
batch. The new HMAC digest uses a **distinct domain separator** so the
heavy-tail engine and the legacy `computeCrashMultiplier` produce
unrelated outputs for the same `(seed, nonce)`:

```
digest = HMAC_SHA256(serverSeed, "aviator:crash-v1|" + clientSeed + ":" + nonce)
u      = uniformFromHmacHex(digest)        # first 52 bits → [0, 1)
M      = sampleMultiplier(u, params)
```

Verification (`verifyCrash`) returns `(multiplier, digest, u)` for any
seed triple — an auditor armed with the revealed `serverSeed` and the
published `clientSeed + nonce + params` can recompute every crash
multiplier offline.

`HEAVY_TAIL_DOMAIN = 'aviator:crash-v1'` is a constant — never edit
without bumping the suffix and recording a new audit boundary.

---

## Files added / modified

### New files

```
backend/src/aviator/crash/
├── distribution.ts                       — pure-math sampler + analytics
├── distribution.spec.ts                  — 28 unit tests
├── modes.ts                              — volatility modes + ExposureTracker
├── modes.spec.ts                         — 17 unit tests
├── engine.ts                             — HMAC → uniform → multiplier glue
├── engine.spec.ts                        — 10 unit tests
├── crash-distribution.service.ts         — NestJS orchestrator
└── crash-distribution.service.spec.ts    — 8 unit tests

backend/scripts/aviator/
└── simulate-crash.ts                     — 100k+ Monte-Carlo CLI

backend/prisma/migrations/
└── 20260524000000_crash_engine_settings/
    └── migration.sql                     — 7-key SystemSetting seed

docs/
└── CRASH_ENGINE.md                       — this document
```

### Modified files

```
backend/src/aviator/aviator.service.ts    — wired in CrashDistributionService
backend/src/aviator/aviator.module.ts     — registered + exported the service
backend/.env.example                      — added AVIATOR_CRASH_* knob list
```

**Unchanged on purpose:**

- `backend/src/aviator/fairness.ts` — legacy provably-fair primitives.
- `backend/src/aviator/fairness-store.ts` — seed lifecycle.
- WebSocket events (`STATE_SNAPSHOT`, `GAME_START`, `GAME_RUNNING`,
  `MULTIPLIER_UPDATE`, `GAME_CRASH`, `PLAYER_BET`, `PLAYER_CASHOUT`,
  `PLAYER_ROSTER`, `RECENT_WINNERS`, `CHAT_*`, `SEED_ROTATED`,
  `ONLINE_COUNT`).
- REST endpoints (`/aviator/bet`, `/aviator/cashout`,
  `/aviator/history`, `/aviator/fairness/*`, `/aviator/chat`).
- Prisma schema (no new tables or columns — all engine config lives
  in the existing `SystemSetting` table).
- Frontend (`aviator/lib/useAviator.ts`, `aviator/lib/store.ts`,
  etc.) — same payloads, same handlers.

---

## Configuration

Every knob is a `SystemSetting` row with an env-var fallback (dotted
key → `SHOUTING_SNAKE`). DB row wins; env is the boot fallback.

| Setting key | Type | Default | Env var | Purpose |
|---|---|---:|---|---|
| `aviator.crash.engine`           | `STRING` | `legacy`     | `AVIATOR_CRASH_ENGINE`           | `legacy` or `heavytail` |
| `aviator.crash.rtp`              | `FLOAT`  | `0.96`       | `AVIATOR_CRASH_RTP`              | Target RTP at `cRef` |
| `aviator.crash.mode`             | `STRING` | `balanced`   | `AVIATOR_CRASH_MODE`             | `balanced` / `fast_loss` / `streamer` |
| `aviator.crash.adaptive_enabled` | `BOOL`   | `true`       | `AVIATOR_CRASH_ADAPTIVE_ENABLED` | EMA-driven mode blending |
| `aviator.crash.alpha`            | `FLOAT`  | `0.20`       | `AVIATOR_CRASH_ALPHA`            | EMA decay (0, 1] |
| `aviator.crash.blend_strength`   | `FLOAT`  | `0.20`       | `AVIATOR_CRASH_BLEND_STRENGTH`   | Exposure factor magnitude |
| `aviator.crash.reference_stake`  | `INT`    | `5000`       | `AVIATOR_CRASH_REFERENCE_STAKE`  | Reference per-round stake (coins) |

Runtime tuning: edit a `SystemSetting` row via the admin Settings UI
(or `UPDATE "SystemSetting" SET value = … WHERE key = …`) and the
engine picks it up on the next round (each `startBettingPhase` calls
`refreshConfig`). Settings cache TTL is 60s; cross-pod propagation is
≤60s.

---

## Integration with the round lifecycle

```
                            ┌───── existing ─────┐
startBettingPhase           │                    │
   │                        │                    │
   ├─ fairness.getOrCreateActive() ──────────────┤
   │                                             │
   ├─ if (crashEngine.isEnabled())                │
   │      crashEngine.generate(seed) ──── new ───┤
   │   else                                       │
   │      computeCrashMultiplier(seed) ───────────┤
   │                                             │
   ├─ apply forcedNextPayout / maxPayout ─────────┤
   │   (admin ceilings unchanged)                 │
   │                                             │
   ├─ AviatorRound.create({ crashMultiplier })   │
   └─ emit GAME_START …                          │
                                                  │
crashRound                                        │
   │                                              │
   ├─ snapshot stake + payout from this.bets ────┤
   ├─ crashEngine.observeRoundOutcome(…)─── new ─┤
   ├─ emit GAME_CRASH …                          │
   └─ schedule next betting phase                 │
                            └────────────────────┘
```

The integration point is **single-line** in `startBettingPhase`:

```typescript
const engineResult = this.crashEngine.generate({
  serverSeed: seed.serverSeed,
  clientSeed: seed.clientSeed,
  nonce,
});
const naturalCrash =
  engineResult?.multiplier ??
  computeCrashMultiplier(seed.serverSeed, seed.clientSeed, nonce);
```

Admin knobs (`forcedNextPayout`, `maxPayout`) still apply after
`naturalCrash` — operators retain manual override.

---

## Logging + auditability

Each round emits exactly one structured log line via the standard
NestJS Logger (no new transport):

```
crash-engine round=12345 nonce=42 seedHash=ba7816bf8f01 \
  mode=BALANCED exposureFactor=-0.0234 rtp=0.9600 paramsHash=4f2a91c8 \
  naturalCrash=2.18 published=2.18
```

Forced-override and ceiling fields are appended when set:

```
… forced=5.00       (admin pinned the round)
… ceiling=100.00    (round was clipped by maxPayout)
```

What an auditor can reproduce from this line + the revealed seed:

1. Recompute the HMAC digest with the published `paramsHash` →
   verify `naturalCrash`.
2. Cross-check `forced` / `ceiling` against the `AviatorSettings` row
   change history.
3. Confirm `mode` matches the configured `aviator.crash.mode` at the
   time the round was generated.

No PII. Safe to ship to a centralised log store.

---

## Migration steps

1. **Merge** — the migration `20260524000000_crash_engine_settings`
   inserts 7 `SystemSetting` rows (all `ON CONFLICT DO NOTHING` so it's
   safe to re-run).
2. **Deploy backend** — engine is disabled by default
   (`aviator.crash.engine='legacy'`). Existing behaviour is unchanged
   byte-for-byte.
3. **Test on staging** — flip `aviator.crash.engine=heavytail` via
   admin SPA → watch the structured logs + the in-game histogram on
   the admin Aviator dashboard for ~100 rounds.
4. **Roll forward to prod** — flip the same key in prod.
5. **Rollback path** — flip back to `legacy`. The legacy
   `computeCrashMultiplier` is still wired and tested; no schema
   change to reverse.

No reboots required. No frontend deploy required. No schema changes
beyond the `SystemSetting` seed.

---

## Example output distributions

100 000 rounds, deterministic seeds, run with:

```bash
npx ts-node scripts/aviator/simulate-crash.ts \
  --rounds 100000 --mode balanced --rtp 0.96
```

### BALANCED, RTP=0.96, 100 000 rounds

```
Bucket histogram (observed vs analytic)
───────────────────────────────────────
  bucket           observed   analytic    delta
  <1.20              10.40%     10.48%   -0.08%
  1.20–1.50          25.66%     25.52%   +0.14%
  1.50–2.00          16.09%     16.00%   +0.09%
  2.00–3.00          16.10%     16.00%   +0.10%
  3.00–5.00          12.77%     12.80%   -0.03%
  5.00–10.00          9.45%      9.60%   -0.15%
  >=10.00             9.53%      9.60%   -0.07%

RTP convergence (cash at C_ref=2.0)
  Configured: 96.00%
  Analytic:   96.00%
  Observed:   95.70%   (drift -0.30pp)

Volatility:
  Max multiplier:           10000.00x
  Longest M<2 streak:       16
  Longest M≥2 streak:       14
```

### FAST_LOSS, RTP=0.96, 100 000 rounds

```
  <1.20              15.00%     14.80%   +0.20%
  1.20–1.50          17.63%     18.00%   -0.38%
  1.50–2.00          19.25%     19.20%   +0.05%
  2.00–3.00          18.42%     18.49%   -0.07%
  3.00–5.00          13.52%     13.52%   -0.00%
  5.00–10.00          9.10%      9.03%   +0.07%
  >=10.00             7.08%      6.96%   +0.12%

Observed RTP@2.0:  96.23%  (drift +0.23pp)
```

### STREAMER, RTP=0.96, 100 000 rounds

```
  <1.20              21.04%     21.10%   -0.06%
  1.20–1.50          17.77%     17.60%   +0.16%
  1.50–2.00          13.29%     13.30%   -0.01%
  2.00–3.00          13.98%     13.99%   -0.01%
  3.00–5.00          11.89%     11.98%   -0.09%
  5.00–10.00          9.84%      9.81%   +0.03%
  >=10.00            12.21%     12.22%   -0.02%

Observed RTP@2.0:  95.82%  (drift -0.18pp)
```

All three modes converge to within 0.3pp of the target RTP over 100k
rounds, and every bucket lands within 0.4pp of the analytic
prediction.

---

## Verifying a crash from cold

Given the published audit line:

```
crash-engine round=12345 nonce=42 seedHash=ba7816bf8f01... \
  mode=BALANCED exposureFactor=-0.0234 rtp=0.9600 paramsHash=4f2a91c8 \
  naturalCrash=2.18 published=2.18
```

and the post-rotation revealed `serverSeed` (matching the published
`seedHash`):

```typescript
import { verifyCrash } from 'backend/src/aviator/crash/engine';
import { MODE_PRESETS } from 'backend/src/aviator/crash/modes';

const result = verifyCrash({
  serverSeed: 'a'.repeat(64),  // revealed at seed rotation
  clientSeed: 'b'.repeat(32),  // from AviatorRound.clientSeed
  nonce: 42,
  params: { ...MODE_PRESETS.BALANCED, rtp: 0.96 },
});

expect(result.multiplier).toBe(2.18);
```

The `paramsHash` in the log is the first 8 hex chars of
`SHA256(JSON.stringify(params, sortedKeys))`. Recompute it from the
mode preset to confirm the round wasn't re-parametrised post-hoc.

---

## Tests + simulator

```bash
cd backend

# Engine-specific test suites (79 tests)
npx jest --testPathPattern 'aviator/(crash|fairness)'

# Full backend (695 tests — engine + existing)
npx jest

# Monte-Carlo simulation
npx ts-node scripts/aviator/simulate-crash.ts --rounds 100000 --mode balanced --rtp 0.96
npx ts-node scripts/aviator/simulate-crash.ts --rounds 1000000 --mode fast_loss --csv out.csv
```

Coverage:

| Spec | What it covers |
|---|---|
| `distribution.spec.ts` | Inverse-CDF determinism, region boundaries, bucket convergence (10k MC), RTP-lock at C_ref, param clamping, `uniformFromHmacHex` |
| `modes.spec.ts` | Preset shapes, `blendDistributions` linearity, RTP preservation under blending, `ExposureTracker` EMA correctness + smoothing + drift correction |
| `engine.spec.ts` | Provably-fair regression vectors, domain separator constant, `verifyCrash` round-trip, long-run RTP convergence |
| `crash-distribution.service.spec.ts` | Default-disabled, mode selection, RTP-at-C_ref preservation, exposure-driven mode switching, `refreshConfig` picks up runtime edits |

---

## Known design trade-offs

1. **RTP-lock vs bucket "feel"**: locking RTP at `C_ref` structurally
   means the survival function is constrained to `P(M ≥ C_ref) = RTP /
   C_ref`. To get the brief's "35% < 1.20x, 3% ≥ 10x" feel at the same
   time, the tail would need to decay faster than 1/x **above C_ref**
   and slower **below C_ref** — which gives players different effective
   edges at different cashout strategies. Real crash games (Bustabit,
   Stake) chose strategy-invariant edge. This engine does too.

2. **k != 1 weakens the invariant slightly**: for FAST_LOSS / STREAMER
   the engine drifts away from pure 1/x. RTP-at-C_ref stays locked
   exactly, but RTP at OTHER cashouts drifts. This is intentional
   (matches real crash sites where aggressive jackpot-hunting strategies
   see worse edge) and visible in the simulator's `Analytic RTP@1.2`
   and `Analytic RTP@10` outputs.

3. **EMA tracker is per-process**: not shared across pods. In the
   worker topology (see [WORKER_TOPOLOGY.md](WORKER_TOPOLOGY.md)) only
   the leader-elected aviator pod runs the game loop, so a local
   tracker is correct. If multi-leader is ever introduced, the tracker
   needs to move to Redis.

4. **Insta-crash mass at `C_ref ≠ 2.0`**: the engine derives the
   tail amplitude assuming the survival contribution at `C_ref` comes
   ENTIRELY from the tail branch (`C_ref >= biasUpper`). If an operator
   sets `cRef < biasUpper`, the RTP-lock invariant degrades. Default
   `cRef = 2.0` and `biasUpper = 1.5` keep this clean — the
   `PARAM_BOUNDS` clamp prevents nonsensical configurations but doesn't
   enforce this specific ordering. Future hardening: add a runtime
   warning when `cRef < biasUpper`.

5. **Insta-crash psychological feel**: brief PDF talks about "near-misses
   just above common cashouts" as an engagement driver. The engine
   doesn't synthesise these on purpose — they emerge naturally from the
   bias band. Operators wanting a stronger near-miss effect should
   lower `bias` and let the tail produce more values in [1.20, 1.50).
*End — last updated 2026-05-21 alongside crash-engine ship.*
