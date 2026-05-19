/**
 * Shared multiplier curve math. The backend ticks every ~50 ms with
 * `MULTIPLIER_UPDATE`, but the canvas renders at 60 fps — between
 * ticks we extrapolate locally so the value never feels steppy.
 *
 * Curve is the same exponential the server uses
 * (`backend/src/aviator/fairness.ts`): `1.0024 ^ (elapsedMs / 10)`,
 * which produces:
 *   - 1.00× at 0 ms
 *   - ~2.00× at ~2.9 s
 *   - ~5.00× at ~6.7 s
 *   - ~10.0× at ~9.6 s
 *
 * Keeping this duplicated client-side is a deliberate trade — it
 * means the rocket smoothly flies between server ticks instead of
 * teleporting forward every 50 ms.
 */
export function multiplierAt(elapsedMs: number): number {
  if (elapsedMs <= 0) return 1.0;
  return Math.pow(1.0024, elapsedMs / 10);
}

/**
 * Inverse of the curve: how long after takeoff does the multiplier
 * cross a given threshold? Used by the auto-cashout marker on the
 * curve so we can show "your auto target lands here" before takeoff.
 */
export function timeForMultiplier(target: number): number {
  if (target <= 1) return 0;
  return Math.log(target) / Math.log(1.0024) * 10;
}

/**
 * Velocity (in ×/s) at a given elapsed time. Used by the mascot to
 * tilt its nose more aggressively as the multiplier accelerates —
 * the sprite's `angle` is biased by `clamp(velocity * 0.04, 0, 0.4)`
 * so a 10× round visibly leans forward harder than a 1.5× round.
 */
export function velocityAt(elapsedMs: number): number {
  // d/dt [1.0024^(t/10)] = (ln 1.0024 / 10) · 1.0024^(t/10)
  const k = Math.log(1.0024) / 10;
  return k * multiplierAt(elapsedMs) * 1000; // ×/s
}
