/**
 * Lumen — the Kalki crash-game mascot. Drawn entirely from canvas
 * paths (no external SVG / PNG / model) so the design is original
 * to this codebase and cannot accidentally resemble any third-party
 * crash-game character.
 *
 * Design language:
 *   - A crystalline "skiff" — an angular wedge with two upswept
 *     wings, a forward-thrust dome, and a glowing core gem.
 *   - It reads as a hybrid between a stealth glider and a comet.
 *   - The core gem and aura shift colour with the multiplier tier
 *     (mint → cyan → ember → crash-red → legendary gold) so the
 *     ship visibly "heats up" as the round climbs.
 *   - Two tiny photoreceptor dots near the dome give it personality
 *     without making it a literal humanoid character.
 *
 * The mascot is always drawn into a local coordinate space centred
 * at (0,0) with the nose pointing +x. Callers translate/rotate the
 * canvas to position it; nothing inside this module assumes a
 * specific world position.
 */

import { tierFor, tierProgress, type Tier } from './tiers';

export interface MascotDrawOptions {
  /** Canvas-space centre of the sprite. */
  x: number;
  y: number;
  /** Local rotation in radians — positive is "nose up". */
  angle: number;
  /** Logical sprite size in pixels. The full sprite (including aura)
   *  may extend ~1.6× this; the keel itself is `size` wide. */
  size: number;
  /** Current multiplier — drives the colour tier and aura intensity. */
  multiplier: number;
  /** Velocity in ×/s — drives squash/stretch and afterburner length. */
  velocity: number;
  /** Phase of the bobbing animation (typically `Date.now()/380`). */
  bobPhase: number;
  /** 0–1 takeoff progress — fade in the aura and afterburners over the
   *  first ~600 ms of the round so the mascot doesn't appear with a
   *  full-blast aura mid-takeoff. */
  ignition?: number;
}

const SPECULAR = '#F2F5FF';
const DEEP_HULL = '#0B1124';
const HULL_PLATE = '#1B2347';
const HULL_EDGE = '#3A4690';
const COCKPIT = '#3DD9FF';

/**
 * Outer halo — a soft radial bloom behind the ship. Sized to the
 * current tier so 10× legendary rounds visibly glow brighter than a
 * 1.5× steady climb.
 */
function drawAura(
  ctx: CanvasRenderingContext2D,
  size: number,
  tier: Tier,
  progress: number,
  ignition: number,
) {
  const radius = size * (0.95 + 0.35 * progress) * ignition;
  if (radius <= 0) return;
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  grad.addColorStop(0, hexToRgba(tier.color, 0.55 * ignition));
  grad.addColorStop(0.45, hexToRgba(tier.color, 0.18 * ignition));
  grad.addColorStop(1, hexToRgba(tier.color, 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Twin afterburner plumes — two slightly offset cone shapes trailing
 * back from the keel. The length scales with velocity, so the visual
 * jet matches the felt acceleration.
 */
function drawAfterburners(
  ctx: CanvasRenderingContext2D,
  size: number,
  tier: Tier,
  velocity: number,
  ignition: number,
  bobPhase: number,
) {
  if (ignition <= 0) return;
  const baseLen = size * 0.45;
  const len = baseLen + Math.min(size * 0.9, velocity * 0.4);
  const flicker = 0.92 + Math.sin(bobPhase * 5) * 0.06;
  const yOff = size * 0.12;

  for (const dir of [-1, 1]) {
    const grad = ctx.createLinearGradient(-size * 0.32, 0, -size * 0.32 - len, 0);
    grad.addColorStop(0, hexToRgba(SPECULAR, 0.9 * ignition));
    grad.addColorStop(0.2, hexToRgba(tier.color, 0.85 * ignition * flicker));
    grad.addColorStop(0.6, hexToRgba(tier.colorDeep, 0.55 * ignition * flicker));
    grad.addColorStop(1, hexToRgba(tier.colorDeep, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-size * 0.30, dir * yOff * 0.7);
    ctx.quadraticCurveTo(
      -size * 0.30 - len * 0.5, dir * yOff * 1.8,
      -size * 0.30 - len, dir * yOff * 0.25,
    );
    ctx.quadraticCurveTo(
      -size * 0.30 - len * 0.4, 0,
      -size * 0.30, -dir * yOff * 0.05,
    );
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Upper and lower wing fins. Drawn as mirrored swept-back triangles
 * with a subtle gradient fill so they read as plate-armour rather
 * than flat polygons. The trailing-edge wing tip carries a small
 * glowing dot in the tier colour.
 */
function drawWings(ctx: CanvasRenderingContext2D, size: number, tier: Tier) {
  for (const dir of [-1, 1]) {
    const grad = ctx.createLinearGradient(0, 0, -size * 0.6, dir * size * 0.55);
    grad.addColorStop(0, HULL_PLATE);
    grad.addColorStop(0.6, '#162047');
    grad.addColorStop(1, DEEP_HULL);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(size * 0.05, dir * size * 0.05);
    ctx.lineTo(-size * 0.10, dir * size * 0.40);
    ctx.lineTo(-size * 0.34, dir * size * 0.46);
    ctx.lineTo(-size * 0.26, dir * size * 0.18);
    ctx.closePath();
    ctx.fill();

    // accent edge
    ctx.strokeStyle = hexToRgba(tier.color, 0.55);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-size * 0.10, dir * size * 0.40);
    ctx.lineTo(-size * 0.34, dir * size * 0.46);
    ctx.stroke();

    // wing tip light
    ctx.fillStyle = tier.color;
    ctx.shadowColor = tier.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(-size * 0.33, dir * size * 0.45, size * 0.025, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

/**
 * The keel — a long wedge that forms the spine of the ship. Stretched
 * slightly along the velocity axis to give a sense of forward thrust.
 */
function drawKeel(
  ctx: CanvasRenderingContext2D,
  size: number,
) {
  // Under-shadow first.
  ctx.fillStyle = DEEP_HULL;
  ctx.beginPath();
  ctx.moveTo(size * 0.50, 0);
  ctx.lineTo(size * 0.05, size * 0.16);
  ctx.lineTo(-size * 0.34, size * 0.10);
  ctx.lineTo(-size * 0.34, -size * 0.10);
  ctx.lineTo(size * 0.05, -size * 0.16);
  ctx.closePath();
  ctx.fill();

  // Top hull plate with a forward-to-back gradient.
  const grad = ctx.createLinearGradient(size * 0.50, 0, -size * 0.34, 0);
  grad.addColorStop(0, '#2A3573');
  grad.addColorStop(0.55, HULL_PLATE);
  grad.addColorStop(1, '#0D1432');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(size * 0.48, 0);
  ctx.lineTo(size * 0.04, size * 0.12);
  ctx.lineTo(-size * 0.30, size * 0.05);
  ctx.lineTo(-size * 0.30, -size * 0.05);
  ctx.lineTo(size * 0.04, -size * 0.12);
  ctx.closePath();
  ctx.fill();

  // Hull centreline highlight.
  ctx.strokeStyle = hexToRgba(SPECULAR, 0.20);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(size * 0.48, 0);
  ctx.lineTo(-size * 0.30, 0);
  ctx.stroke();

  // Forward edge highlight — the strongest specular hit.
  ctx.strokeStyle = hexToRgba(SPECULAR, 0.55);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(size * 0.48, 0);
  ctx.lineTo(size * 0.04, -size * 0.12);
  ctx.stroke();
}

/**
 * Cockpit dome + two tiny photoreceptor dots. The dome is just a
 * cyan teardrop near the nose; the dots are positioned where eyes
 * would be on a humanoid character, giving the mascot personality
 * without making it humanoid.
 */
function drawCockpit(
  ctx: CanvasRenderingContext2D,
  size: number,
  bobPhase: number,
) {
  const grad = ctx.createRadialGradient(
    size * 0.18, -size * 0.04, 0,
    size * 0.18, 0, size * 0.18,
  );
  grad.addColorStop(0, hexToRgba(SPECULAR, 0.92));
  grad.addColorStop(0.45, hexToRgba(COCKPIT, 0.75));
  grad.addColorStop(1, hexToRgba(COCKPIT, 0.15));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(size * 0.22, 0, size * 0.14, size * 0.075, 0, 0, Math.PI * 2);
  ctx.fill();

  // Two photoreceptor dots — they twinkle slightly out of phase.
  const blinkA = 0.7 + Math.sin(bobPhase * 1.4) * 0.25;
  const blinkB = 0.7 + Math.sin(bobPhase * 1.4 + 1.7) * 0.25;
  ctx.fillStyle = hexToRgba(SPECULAR, blinkA);
  ctx.beginPath();
  ctx.arc(size * 0.28, -size * 0.02, size * 0.014, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexToRgba(SPECULAR, blinkB);
  ctx.beginPath();
  ctx.arc(size * 0.28, size * 0.025, size * 0.012, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Core gem — a small diamond on the spine that pulses in the tier
 * colour. The "soul" of the ship.
 */
function drawCore(
  ctx: CanvasRenderingContext2D,
  size: number,
  tier: Tier,
  bobPhase: number,
) {
  const breath = 1 + Math.sin(bobPhase * 2.3) * 0.18;
  const r = size * 0.045 * breath;

  ctx.save();
  ctx.shadowColor = tier.color;
  ctx.shadowBlur = 14;
  ctx.fillStyle = tier.color;
  ctx.beginPath();
  ctx.moveTo(-size * 0.06, -r);
  ctx.lineTo(-size * 0.02, 0);
  ctx.lineTo(-size * 0.06, r);
  ctx.lineTo(-size * 0.10, 0);
  ctx.closePath();
  ctx.fill();

  // bright centre dot
  ctx.shadowBlur = 0;
  ctx.fillStyle = SPECULAR;
  ctx.beginPath();
  ctx.arc(-size * 0.06, 0, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Outline — a single dark stroke around the upper silhouette of
 * the keel + wings. This is the trick that makes the mascot read as
 * one cohesive shape rather than a stack of separate polygons.
 */
function drawSilhouette(ctx: CanvasRenderingContext2D, size: number, tier: Tier) {
  ctx.strokeStyle = hexToRgba(tier.color, 0.35);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(size * 0.48, 0);
  ctx.lineTo(size * 0.04, -size * 0.12);
  ctx.lineTo(-size * 0.10, -size * 0.40);
  ctx.lineTo(-size * 0.34, -size * 0.46);
  ctx.lineTo(-size * 0.30, -size * 0.05);
  ctx.lineTo(-size * 0.30, size * 0.05);
  ctx.lineTo(-size * 0.34, size * 0.46);
  ctx.lineTo(-size * 0.10, size * 0.40);
  ctx.lineTo(size * 0.04, size * 0.12);
  ctx.closePath();
  ctx.stroke();
}

/**
 * Main entry point. Saves/restores the canvas state, applies the
 * pose transform, and stacks the layers. Callers should already
 * have translated to the world position.
 */
export function drawMascot(
  ctx: CanvasRenderingContext2D,
  opts: MascotDrawOptions,
) {
  const tier = tierFor(opts.multiplier);
  const progress = tierProgress(opts.multiplier);
  const ignition = opts.ignition ?? 1;

  ctx.save();
  ctx.translate(opts.x, opts.y);
  ctx.rotate(opts.angle);

  // Velocity-based squash/stretch — stretches along the nose axis as
  // velocity climbs. Capped so the ship never looks deformed.
  const stretch = 1 + Math.min(0.22, opts.velocity * 0.012);
  const squash = 1 - Math.min(0.10, opts.velocity * 0.005);
  ctx.scale(stretch, squash);

  drawAura(ctx, opts.size, tier, progress, ignition);
  drawAfterburners(ctx, opts.size, tier, opts.velocity, ignition, opts.bobPhase);
  drawWings(ctx, opts.size, tier);
  drawKeel(ctx, opts.size);
  drawSilhouette(ctx, opts.size, tier);
  drawCockpit(ctx, opts.size, opts.bobPhase);
  drawCore(ctx, opts.size, tier, opts.bobPhase);

  ctx.restore();
}

/**
 * Draws the mascot tumbling away at crash time. Same sprite, but
 * spinning + falling out of frame so the player gets a visceral
 * "lost it" beat instead of a clean disappear.
 */
export function drawMascotCrashing(
  ctx: CanvasRenderingContext2D,
  opts: MascotDrawOptions & { sinceCrashMs: number },
) {
  const t = Math.min(1, opts.sinceCrashMs / 900);
  const fall = t * t * 320;
  const spin = opts.angle + t * Math.PI * 2.4;
  drawMascot(ctx, {
    ...opts,
    y: opts.y + fall,
    x: opts.x + Math.sin(t * 6) * 6,
    angle: spin,
    ignition: Math.max(0, 1 - t * 1.3),
    multiplier: opts.multiplier, // colour stays on the crash tier
    velocity: 0,
  });
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export { hexToRgba };
