'use client';

import { useEffect, useRef } from 'react';
import { useGame } from '@/lib/store';
import { multiplierAt, timeForMultiplier, velocityAt } from '@/lib/curve';
import { drawMascot, drawMascotCrashing, hexToRgba } from '@/lib/mascot';
import { tierFor, tierProgress, type Tier } from '@/lib/tiers';
import { formatMultiplier } from '@/lib/format';

/**
 * The visual heart of the game. A single `<canvas>` renders the
 * parallax starfield, multiplier curve, mascot, particle trails,
 * auto-cashout marker, crash sequence — and now the live multiplier
 * value as a label travelling with the mascot on the curve, so the
 * eye doesn't bounce between a static centre-screen readout and the
 * mascot itself.
 *
 * Numerical context that doesn't move with the mascot (countdown,
 * crash result chip) lives in the DOM siblings layered on top of
 * the canvas — see `MultiplierDisplay.tsx`.
 *
 * Frame budget:
 *   ~1 starfield repaint  (cheap, 70 stars)
 *   ~110-point curve path (cheap, 1 path)
 *   ~12-layer mascot      (cheap, all path-based)
 *   ~220 live particles   (capped — old ones expire each frame)
 * Comfortably 60 fps on a mid-range phone.
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  /** trail particles use additive blending so they bloom; debris
   *  particles render normal so they read as solid sparks. */
  blend: 'screen' | 'normal';
}

interface Star {
  x: number;
  y: number;
  /** 0 = far layer (slow), 1 = near layer (fast) */
  layer: number;
  size: number;
  alpha: number;
}

const STAR_COUNT = 70;
const PARTICLE_CAP = 220;
const PADDING = { top: 36, bottom: 28, left: 28, right: 56 } as const;

/** Sprite size — also acts as the "safe inset" we clamp mascot
 *  position to, so the wings never disappear past the canvas edge. */
const MASCOT_SIZE = 72;
const MASCOT_RADIUS = MASCOT_SIZE * 0.55; // half-width including aura ring

export default function GameStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Per-mount local state — refs are scoped to this effect so React
    // strict-mode double-mount doesn't share particle arrays across
    // two instances.
    const local = {
      mascotPos: { x: 0, y: 0, angle: 0 },
      particles: [] as Particle[],
      stars: [] as Star[],
      lastPhase: 'UNKNOWN' as string,
      lastFrame: 0,
      trailSpawnAt: 0,
      crashedAt: 0,
    };

    let raf = 0;

    function frame(ts: number) {
      const dt = local.lastFrame ? ts - local.lastFrame : 16;
      local.lastFrame = ts;

      const ctx = canvas!.getContext('2d');
      if (!ctx) {
        raf = requestAnimationFrame(frame);
        return;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = canvas!.clientWidth;
      const cssH = canvas!.clientHeight;
      const targetW = Math.round(cssW * dpr);
      const targetH = Math.round(cssH * dpr);
      if (canvas!.width !== targetW || canvas!.height !== targetH) {
        canvas!.width = targetW;
        canvas!.height = targetH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      ensureStars(local.stars, cssW, cssH);

      const state = useGame.getState();
      const phase = state.phase;

      // Phase boundary side-effects.
      if (local.lastPhase !== phase) {
        if (phase === 'CRASHED') {
          spawnCrashBurst(
            local.particles,
            local.mascotPos.x,
            local.mascotPos.y,
            state.lastCrash?.multiplier ?? state.multiplier ?? 1,
          );
          local.crashedAt = ts;
        } else if (phase === 'BETTING') {
          local.particles.length = 0;
          local.mascotPos = { x: 0, y: 0, angle: 0 };
        }
        local.lastPhase = phase;
      }

      drawBackdrop(ctx, cssW, cssH, state.multiplier);
      drawStars(ctx, local.stars, cssW, cssH, dt, phase);
      drawHorizonGrid(ctx, cssW, cssH);

      if (phase === 'RUNNING' && state.startedAt) {
        const elapsed = Date.now() - state.startedAt;
        const r = drawCurveAndMascot(
          ctx,
          cssW,
          cssH,
          elapsed,
          state.multiplier,
          local.particles,
          ts,
          local.trailSpawnAt,
        );
        local.trailSpawnAt = r.trailSpawnAt;
        local.mascotPos = r.mascotPos;
      } else if (phase === 'CRASHED') {
        drawCrashState(
          ctx,
          cssW,
          cssH,
          ts - local.crashedAt,
          local.mascotPos,
          state.lastCrash?.multiplier ?? state.multiplier ?? 1,
        );
      } else {
        local.mascotPos = drawIdleMascot(ctx, cssW, cssH, ts, local.particles, phase);
      }

      if (
        phase === 'RUNNING' &&
        state.startedAt &&
        state.currentBet?.autoCashoutAt &&
        state.currentBet.cashedOutAt === null
      ) {
        drawAutoCashoutMarker(
          ctx,
          cssW,
          cssH,
          state.startedAt,
          state.currentBet.autoCashoutAt,
          state.multiplier,
        );
      }

      updateParticles(ctx, local.particles, dt);

      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full block"
      aria-label="Crash game arena"
    />
  );
}

/* ============================================================
   Drawing primitives — pure functions, no module-level state.
   ============================================================ */

function ensureStars(stars: Star[], w: number, h: number) {
  if (stars.length === STAR_COUNT) {
    const first = stars[0];
    if (first.x < w && first.y < h) return;
  }
  stars.length = 0;
  for (let i = 0; i < STAR_COUNT; i++) {
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      layer: Math.random(),
      size: 0.6 + Math.random() * 1.4,
      alpha: 0.25 + Math.random() * 0.55,
    });
  }
}

function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  multiplier: number,
) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(14, 18, 38, 0.95)');
  grad.addColorStop(1, 'rgba(8, 11, 26, 1)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const tier = tierFor(multiplier);
  const bloomR = Math.min(w, h) * (0.6 + 0.3 * tierProgress(multiplier));
  const bloom = ctx.createRadialGradient(w * 0.78, h * 0.22, 0, w * 0.78, h * 0.22, bloomR);
  bloom.addColorStop(0, hexToRgba(tier.color, 0.10));
  bloom.addColorStop(1, hexToRgba(tier.color, 0));
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, w, h);
}

function drawStars(
  ctx: CanvasRenderingContext2D,
  list: Star[],
  w: number,
  h: number,
  dt: number,
  phase: string,
) {
  const speedMul = phase === 'RUNNING' ? 1 : 0.35;
  for (const s of list) {
    s.x -= (8 + s.layer * 60) * speedMul * (dt / 1000);
    if (s.x < -4) {
      s.x = w + 4;
      s.y = Math.random() * h;
    }
    ctx.fillStyle = `rgba(220, 230, 255, ${s.alpha})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHorizonGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save();
  ctx.strokeStyle = 'rgba(141, 158, 232, 0.08)';
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.moveTo(PADDING.left, h - PADDING.bottom);
  ctx.lineTo(w - PADDING.right, h - PADDING.bottom);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(PADDING.left, PADDING.top);
  ctx.lineTo(PADDING.left, h - PADDING.bottom);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(141, 158, 232, 0.04)';
  const yStep = (h - PADDING.top - PADDING.bottom) / 6;
  for (let i = 1; i < 6; i++) {
    const y = h - PADDING.bottom - yStep * i;
    ctx.beginPath();
    ctx.moveTo(PADDING.left, y);
    ctx.lineTo(w - PADDING.right, y);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Clamp a mascot world position so the entire sprite (including the
 * outer aura ring) is always inside the canvas — never half-clipped
 * past the right or top edge. Fixes the "mascot flies off-screen and
 * comes back" effect on tall, thin viewports.
 */
function clampMascotPos(
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number } {
  return {
    x: Math.min(w - MASCOT_RADIUS, Math.max(MASCOT_RADIUS, x)),
    y: Math.min(h - MASCOT_RADIUS, Math.max(MASCOT_RADIUS, y)),
  };
}

function drawIdleMascot(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  ts: number,
  particles: Particle[],
  phase: string,
): { x: number; y: number; angle: number } {
  // Idle position: roughly bottom-quarter, left-quarter — same as
  // where the curve will start from on takeoff so the eye doesn't
  // have to jump when RUNNING begins.
  const rawY = h - 80 + Math.sin(ts / 380) * 5;
  const rawX = Math.max(MASCOT_RADIUS + 14, w * 0.13);
  const angle = -0.18 + Math.sin(ts / 700) * 0.05;
  const { x, y } = clampMascotPos(rawX, rawY, w, h);

  // Small thruster sparks while waiting — keeps the scene alive.
  if (phase !== 'CRASHED' && particles.length < PARTICLE_CAP && Math.random() < 0.25) {
    particles.push({
      x: x - 18,
      y: y + 6 + (Math.random() - 0.5) * 6,
      vx: -20 - Math.random() * 18,
      vy: (Math.random() - 0.5) * 16,
      life: 0,
      maxLife: 420 + Math.random() * 200,
      color: '#3DD9FF',
      size: 1 + Math.random() * 1.4,
      blend: 'screen',
    });
  }

  drawMascot(ctx, {
    x, y, angle,
    size: MASCOT_SIZE,
    multiplier: 1.0,
    velocity: 0,
    bobPhase: ts / 380,
    ignition: 0.4,
  });

  return { x, y, angle };
}

function drawCurveAndMascot(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  elapsedMs: number,
  currentMultiplier: number,
  particles: Particle[],
  ts: number,
  trailSpawnAt: number,
): {
  trailSpawnAt: number;
  mascotPos: { x: number; y: number; angle: number };
} {
  const drawW = w - PADDING.left - PADDING.right;
  const drawH = h - PADDING.top - PADDING.bottom;

  // Viewport widens as the round progresses so the curve always has
  // headroom — without this the trajectory crashes into the top of
  // the frame after ~6 seconds.
  const T_VIEW_MS = Math.max(8_000, elapsedMs + 1_500);
  const M_VIEW_MAX = Math.max(2.0, currentMultiplier * 1.35);

  const steps = 110;
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * elapsedMs;
    const m = multiplierAt(t);
    const x = PADDING.left + (t / T_VIEW_MS) * drawW;
    const y = PADDING.top + drawH - ((m - 1) / (M_VIEW_MAX - 1)) * drawH;
    points.push([x, y]);
  }
  if (points.length === 0) points.push([PADDING.left, PADDING.top + drawH]);

  const tier = tierFor(currentMultiplier);
  const last = points[points.length - 1];

  // Glow fill under the curve.
  const fill = ctx.createLinearGradient(0, PADDING.top, 0, PADDING.top + drawH);
  fill.addColorStop(0, hexToRgba(tier.color, 0.35));
  fill.addColorStop(0.7, hexToRgba(tier.color, 0.10));
  fill.addColorStop(1, hexToRgba(tier.color, 0));
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(PADDING.left, PADDING.top + drawH);
  for (const [x, y] of points) ctx.lineTo(x, y);
  ctx.lineTo(last[0], PADDING.top + drawH);
  ctx.closePath();
  ctx.fill();

  // Curve stroke — cool at the origin, tier colour at the leading edge.
  const stroke = ctx.createLinearGradient(PADDING.left, 0, PADDING.left + drawW, 0);
  stroke.addColorStop(0, '#3DD9FF');
  stroke.addColorStop(0.55, tier.color);
  stroke.addColorStop(1, tier.color);
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 3.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = tier.color;
  ctx.shadowBlur = 20;
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();

  // Mascot — at the leading edge, aligned to the local tangent, with
  // a hard clamp so it can't slide past the right/top edge of the
  // canvas (previously it could briefly disappear past padding.right
  // on the first frames of takeoff before the viewport scaling
  // caught up).
  const [rawPx, rawPy] = last;
  const { x: px, y: py } = clampMascotPos(rawPx, rawPy, w, h);
  const prev = points[points.length - 2] ?? last;
  const angle = Math.atan2(rawPy - prev[1], rawPx - prev[0]);
  const velocity = velocityAt(elapsedMs);

  // Trail particles spawn rate scales with velocity.
  let nextTrailSpawnAt = trailSpawnAt;
  const interval = Math.max(18, 110 - velocity * 0.3);
  if (ts - trailSpawnAt > interval) {
    nextTrailSpawnAt = ts;
    emitTrailParticles(particles, px, py, angle, tier.color, tier.colorDeep);
  }

  drawMascot(ctx, {
    x: px,
    y: py,
    angle,
    size: MASCOT_SIZE,
    multiplier: currentMultiplier,
    velocity,
    bobPhase: ts / 380,
    ignition: Math.min(1, elapsedMs / 700),
  });

  // Live multiplier label — drawn next to the mascot so the eye
  // tracks one focal point instead of bouncing between a giant
  // centred number and the leading edge of the curve.
  drawMultiplierLabel(ctx, px, py, currentMultiplier, tier, w, h);

  return {
    trailSpawnAt: nextTrailSpawnAt,
    mascotPos: { x: px, y: py, angle },
  };
}

/**
 * Multiplier label that travels with the mascot, anchored to a HUD-
 * style position above-and-to-the-right of the sprite. The order of
 * fallbacks (most-preferred → least-preferred) is:
 *
 *   1. Above-and-right — feels like an overhead HUD callout, keeps
 *      the chip clear of both the mascot's wings and the recent
 *      curve trail underneath it.
 *   2. Vertically centred to the right — used when the mascot is
 *      high enough that "above" would clip the top of the canvas
 *      (the apex of the curve).
 *   3. Vertically centred to the left — used when the mascot is
 *      close to the right edge of the canvas and there's no room
 *      on the right at all.
 *   4. Below-and-right — last resort, when neither side has room
 *      vertically (only kicks in for extremely tall/narrow stages).
 *
 * Tier glow + bold mono digits, with a top-status pill at top-centre
 * the player never has to look away from the mascot to read it.
 */
function drawMultiplierLabel(
  ctx: CanvasRenderingContext2D,
  mascotX: number,
  mascotY: number,
  multiplier: number,
  tier: Tier,
  w: number,
  h: number,
) {
  const label = formatMultiplier(multiplier);
  const fontPx = 30;
  ctx.save();
  ctx.font = `900 ${fontPx}px "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.textBaseline = 'middle';
  const metrics = ctx.measureText(label);
  const textW = metrics.width;
  const padX = 10;
  const boxW = textW + padX * 2;
  const boxH = fontPx + 12;

  // Top-centre status pill (BettingPill/CrashedPill/RunningPill) is
  // ~32 px tall + 12 px margin — keep at least 56 px clear at the
  // very top of the canvas so the chip never overlaps it.
  const TOP_SAFE = 56;

  // Preferred: above-and-right of the mascot.
  let bx = mascotX + MASCOT_RADIUS * 0.6;
  let by = mascotY - MASCOT_RADIUS * 0.7 - boxH;

  const rightOverflow = bx + boxW > w - 8;
  const topOverflow = by < TOP_SAFE;

  if (rightOverflow && topOverflow) {
    // Both above and right are tight → centre-left of mascot.
    bx = mascotX - MASCOT_RADIUS - 8 - boxW;
    by = mascotY - boxH / 2;
  } else if (topOverflow) {
    // Apex of the curve — drop to centre-right.
    bx = mascotX + MASCOT_RADIUS + 8;
    by = mascotY - boxH / 2;
  } else if (rightOverflow) {
    // Hugging the right edge — flip the chip above-and-left instead.
    bx = mascotX - MASCOT_RADIUS * 0.6 - boxW;
  }

  // Final safety clamps — never let the chip leave the canvas, even
  // on a 1-frame layout race during resize.
  bx = Math.max(8, Math.min(bx, w - boxW - 8));
  by = Math.max(8, Math.min(by, h - boxH - 8));

  // Chip background — same dark base everywhere, tier-tinted border.
  ctx.fillStyle = 'rgba(8, 11, 26, 0.78)';
  ctx.strokeStyle = hexToRgba(tier.color, 0.55);
  ctx.lineWidth = 1.2;
  roundedRect(ctx, bx, by, boxW, boxH, 10);
  ctx.fill();
  ctx.stroke();

  // Glow + text.
  ctx.fillStyle = tier.color;
  ctx.shadowColor = tier.color;
  ctx.shadowBlur = 14;
  ctx.fillText(label, bx + padX, by + boxH / 2);
  ctx.restore();
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function emitTrailParticles(
  particles: Particle[],
  x: number,
  y: number,
  angle: number,
  color: string,
  colorDeep: string,
) {
  if (particles.length > PARTICLE_CAP) return;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const sx = x + -28 * c;
  const sy = y + -28 * s;
  for (let i = 0; i < 2; i++) {
    const spread = (Math.random() - 0.5) * 0.6;
    const sa = angle + Math.PI + spread;
    const speed = 80 + Math.random() * 70;
    particles.push({
      x: sx + (Math.random() - 0.5) * 6,
      y: sy + (Math.random() - 0.5) * 6,
      vx: Math.cos(sa) * speed,
      vy: Math.sin(sa) * speed,
      life: 0,
      maxLife: 500 + Math.random() * 300,
      color: Math.random() < 0.5 ? color : colorDeep,
      size: 1.2 + Math.random() * 1.8,
      blend: 'screen',
    });
  }
}

function spawnCrashBurst(
  particles: Particle[],
  x: number,
  y: number,
  crashMultiplier: number,
) {
  const tier = tierFor(crashMultiplier);
  const palette = [tier.color, tier.colorDeep, '#F2F5FF', '#FFC857'];
  const count = 48 + Math.floor(Math.min(40, crashMultiplier * 2));
  for (let i = 0; i < count; i++) {
    const ang = (Math.PI * 2 * i) / count + Math.random() * 0.5 - 0.25;
    const speed = 80 + Math.random() * 360;
    particles.push({
      x,
      y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed - 50,
      life: 0,
      maxLife: 700 + Math.random() * 700,
      color: palette[i % palette.length],
      size: 1.4 + Math.random() * 2.8,
      blend: i % 2 === 0 ? 'screen' : 'normal',
    });
  }
}

function updateParticles(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  dt: number,
) {
  const dtSec = dt / 1000;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    if (p.life >= p.maxLife) {
      particles.splice(i, 1);
      continue;
    }
    p.x += p.vx * dtSec;
    p.y += p.vy * dtSec;
    p.vy += 280 * dtSec;
    p.vx *= 0.985;
  }
  for (const blend of ['screen', 'normal'] as const) {
    ctx.save();
    ctx.globalCompositeOperation = blend === 'screen' ? 'lighter' : 'source-over';
    for (const p of particles) {
      if (p.blend !== blend) continue;
      const alpha = 1 - p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = blend === 'screen' ? 8 : 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawCrashState(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sinceCrashMs: number,
  pos: { x: number; y: number; angle: number },
  crashMultiplier: number,
) {
  const flash = Math.max(0, 1 - sinceCrashMs / 600);
  ctx.fillStyle = `rgba(255, 77, 109, ${0.18 * flash})`;
  ctx.fillRect(0, 0, w, h);

  if (pos.x > 0 && pos.y > 0) {
    // Clamp the tumble destination so the mascot doesn't fall below
    // the canvas — better to see it slow-spin in the lower third
    // than disappear off the bottom edge.
    const tumbleY = Math.min(pos.y + (sinceCrashMs / 900) ** 2 * 320, h - MASCOT_RADIUS);
    drawMascotCrashing(ctx, {
      x: pos.x,
      y: tumbleY - (sinceCrashMs / 900) ** 2 * 320,
      angle: pos.angle,
      size: MASCOT_SIZE,
      multiplier: crashMultiplier,
      velocity: 0,
      bobPhase: sinceCrashMs / 380,
      sinceCrashMs,
    });

    // Crash-multiplier label on the tumbling mascot so the result
    // is right where the player's eye is.
    drawMultiplierLabel(
      ctx,
      pos.x,
      Math.min(tumbleY, h - MASCOT_RADIUS),
      crashMultiplier,
      tierFor(crashMultiplier),
      w,
      h,
    );
  }
}

function drawAutoCashoutMarker(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  startedAt: number,
  autoCashoutAt: number,
  currentMultiplier: number,
) {
  const elapsed = Date.now() - startedAt;
  const targetT = timeForMultiplier(autoCashoutAt);
  if (targetT <= elapsed) return;

  const drawW = w - PADDING.left - PADDING.right;
  const drawH = h - PADDING.top - PADDING.bottom;
  const T_VIEW_MS = Math.max(8_000, elapsed + 1_500);
  const M_VIEW_MAX = Math.max(2.0, currentMultiplier * 1.35);

  const x = PADDING.left + (targetT / T_VIEW_MS) * drawW;
  const y = PADDING.top + drawH - ((autoCashoutAt - 1) / (M_VIEW_MAX - 1)) * drawH;
  if (x > w - PADDING.right || y < PADDING.top) return;

  ctx.save();
  ctx.strokeStyle = 'rgba(34, 224, 189, 0.45)';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, h - PADDING.bottom);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(34, 224, 189, 0.85)';
  ctx.shadowColor = 'rgba(34, 224, 189, 0.7)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.font = '600 11px "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#22E0BD';
  ctx.fillText(`auto ${autoCashoutAt.toFixed(2)}×`, x + 10, y);
  ctx.restore();
}
