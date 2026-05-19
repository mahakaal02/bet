'use client';

import { useEffect, useRef, useState } from 'react';
import { useGame } from '@/lib/store';

/**
 * Astronaut-on-rocket stage. Canvas-based — mirrors `PlaneStage` so
 * the rocket flies along the EXACT same exponential curve, with the
 * same trail glow + crash particles. The only difference is the plane
 * shape is replaced by the SVG sprite at `/astro-rocket.svg`.
 *
 * The first version of this used framer-motion overlays + a smile
 * `<path>` element pinned to viewBox coordinates I guessed wrong. The
 * smile floated off the boy's face like a free-standing emoji and
 * the rocket didn't follow the curve. Replacing the canvas-drawn
 * plane with the SVG sprite is much closer to the original behaviour
 * and matches the user's spec ("the boy would fly along the curve of
 * aeroplane").
 *
 * # White-background cleanup
 * Magnific auto-traced the cartoon from a PNG. Even though the SVG
 * itself has no `<rect>` background, the smoke-cloud path uses the
 * same light-grey colour as the spacesuit (rgb 227,227,225) and reads
 * as a "white halo" around the boy. To strip it cleanly we'd have to
 * split that path; for now we just alpha-out pixels brighter than
 * (240,240,240) at sprite load time. That kills any anti-alias
 * halos on the file edges without touching the suit colour, which is
 * dark enough to survive the threshold.
 */

// Same multiplier curve the server emits (`backend/src/aviator/fairness.ts`)
// — kept local so the canvas can render frames without waiting for the
// next MULTIPLIER_UPDATE tick.
function multiplierAt(elapsedMs: number) {
  if (elapsedMs <= 0) return 1.0;
  return Math.pow(1.0024, elapsedMs / 10);
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

const COLOR_BG_GRID = 'rgba(255, 255, 255, 0.05)';
const TRAIL_FROM = '#FF4D5A';
const TRAIL_TO = '#FF8C42';

// Anti-alias halo cutoff. Pure white edge pixels around the sprite get
// alpha=0; the spacesuit's rgb(227,227,225) is well below this threshold
// and stays opaque. Tune up to drop the suit too, down to keep more halo.
const WHITE_THRESHOLD = 240;

/**
 * Load the rocket SVG and pre-process its alpha channel so any
 * near-white pixel becomes transparent. Returns the processed sprite
 * as an offscreen `<canvas>` so drawImage on the live canvas is fast.
 *
 * If the offscreen canvas turns out to be cross-origin-tainted we
 * fall back to using the raw image — the user will still see the
 * sprite, just with the original anti-alias halo.
 */
async function loadProcessedRocket(): Promise<CanvasImageSource | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 1024;
      const h = img.naturalHeight || 1024;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return resolve(img);
      ctx.drawImage(img, 0, 0, w, h);
      try {
        const data = ctx.getImageData(0, 0, w, h);
        const px = data.data;
        for (let i = 0; i < px.length; i += 4) {
          if (
            px[i] > WHITE_THRESHOLD &&
            px[i + 1] > WHITE_THRESHOLD &&
            px[i + 2] > WHITE_THRESHOLD
          ) {
            px[i + 3] = 0;
          }
        }
        ctx.putImageData(data, 0, 0);
        resolve(canvas);
      } catch {
        // Tainted canvas — fall through to the raw image.
        resolve(img);
      }
    };
    img.onerror = () => resolve(null);
    img.src = '/astro-rocket.svg';
  });
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save();
  ctx.strokeStyle = COLOR_BG_GRID;
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Draw the rocket sprite centred at (x,y), rotated to align with the
 * current trajectory tangent. The sprite ships at 1024×1024; we draw
 * at a fixed canvas size of `SPRITE_PX` so it's visually balanced
 * against the curve glow regardless of the underlying SVG resolution.
 */
const SPRITE_PX = 88;
function drawRocket(
  ctx: CanvasRenderingContext2D,
  sprite: CanvasImageSource,
  x: number,
  y: number,
  angle: number,
  scale = 1,
) {
  ctx.save();
  ctx.translate(x, y);
  // The SVG art points up-and-right (rocket nose at +x, exhaust at -x).
  // The plane curve tangent is also +x-ish at the leading edge, so the
  // angle from atan2(dy, dx) is the right thing — no offset needed.
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  const s = SPRITE_PX;
  ctx.shadowColor = 'rgba(255, 140, 66, 0.55)';
  ctx.shadowBlur = 14;
  ctx.drawImage(sprite, -s / 2, -s / 2, s, s);
  ctx.restore();
}

function spawnCrashParticles(particles: Particle[], x: number, y: number) {
  const palette = [TRAIL_FROM, TRAIL_TO, '#F5F7FF', '#FFCD56'];
  for (let i = 0; i < 36; i++) {
    const angle = (Math.PI * 2 * i) / 36 + Math.random() * 0.4 - 0.2;
    const speed = 90 + Math.random() * 260;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 40,
      life: 0,
      maxLife: 700 + Math.random() * 500,
      color: palette[i % palette.length],
      size: 2 + Math.random() * 3,
    });
  }
}

function updateAndDrawParticles(
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
    p.vy += 320 * dtSec;
    p.vx *= 0.985;
    const alpha = 1 - p.life / p.maxLife;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

interface DrawCurveResult {
  rocketX: number;
  rocketY: number;
  angle: number;
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  textColor: string,
  canvasW: number,
) {
  ctx.save();
  ctx.font =
    'bold 22px "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textBaseline = 'middle';
  const metrics = ctx.measureText(text);
  const textW = metrics.width;
  const padX = 8;
  const boxW = textW + padX * 2;
  const boxH = 28;

  // Position the chip on the right of the rocket; flip below if it
  // would clip the top, flip to the left side of the rocket if it
  // would overflow the right edge of the canvas.
  let bx = x + 50;
  let by = y - boxH / 2 - 4;
  if (bx + boxW > canvasW - 8) bx = x - 50 - boxW;
  if (by < 6) by = y + 38;

  ctx.fillStyle = 'rgba(11, 16, 32, 0.78)';
  ctx.strokeStyle = 'rgba(255, 140, 66, 0.45)';
  ctx.lineWidth = 1;
  const r = 8;
  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + boxW - r, by);
  ctx.quadraticCurveTo(bx + boxW, by, bx + boxW, by + r);
  ctx.lineTo(bx + boxW, by + boxH - r);
  ctx.quadraticCurveTo(bx + boxW, by + boxH, bx + boxW - r, by + boxH);
  ctx.lineTo(bx + r, by + boxH);
  ctx.quadraticCurveTo(bx, by + boxH, bx, by + boxH - r);
  ctx.lineTo(bx, by + r);
  ctx.quadraticCurveTo(bx, by, bx + r, by);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.shadowColor = textColor;
  ctx.shadowBlur = 10;
  ctx.fillText(text, bx + padX, by + boxH / 2);
  ctx.restore();
}

function drawCurveAndRocket(
  ctx: CanvasRenderingContext2D,
  sprite: CanvasImageSource,
  w: number,
  h: number,
  elapsedMs: number,
  currentMultiplier: number,
): DrawCurveResult {
  const padding = { top: 36, bottom: 28, left: 28, right: 48 };
  const drawW = w - padding.left - padding.right;
  const drawH = h - padding.top - padding.bottom;

  const T_VIEW_MS = Math.max(8_000, elapsedMs + 1_200);
  const M_VIEW_MAX = Math.max(2.0, currentMultiplier * 1.3);

  const steps = 110;
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * elapsedMs;
    const m = multiplierAt(t);
    const x = padding.left + (t / T_VIEW_MS) * drawW;
    const y = padding.top + drawH - ((m - 1) / (M_VIEW_MAX - 1)) * drawH;
    points.push([x, y]);
  }
  if (points.length === 0) {
    points.push([padding.left, padding.top + drawH]);
  }

  // Glow fill under the curve.
  const last = points[points.length - 1];
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top + drawH);
  for (const [x, y] of points) ctx.lineTo(x, y);
  ctx.lineTo(last[0], padding.top + drawH);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, padding.top, 0, padding.top + drawH);
  fill.addColorStop(0, 'rgba(255, 140, 66, 0.32)');
  fill.addColorStop(1, 'rgba(255, 77, 90, 0.04)');
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();

  // Trail stroke.
  ctx.save();
  const stroke = ctx.createLinearGradient(padding.left, 0, padding.left + drawW, 0);
  stroke.addColorStop(0, TRAIL_FROM);
  stroke.addColorStop(1, TRAIL_TO);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = TRAIL_TO;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();

  // Rocket sprite at the leading edge, aligned to the local tangent.
  const [px, py] = last;
  const prev = points[points.length - 2] ?? last;
  const angle = Math.atan2(py - prev[1], px - prev[0]);
  drawRocket(ctx, sprite, px, py, angle, 1);

  // Multiplier chip travelling with the rocket.
  drawLabel(ctx, px, py, `${currentMultiplier.toFixed(2)}×`, TRAIL_TO, w);

  return { rocketX: px, rocketY: py, angle };
}

function drawIdle(
  ctx: CanvasRenderingContext2D,
  sprite: CanvasImageSource,
  _w: number,
  h: number,
) {
  // The rocket gently bobs at the bottom-left while we wait for the
  // round. Subtle sine-wave motion — keeps the scene from feeling
  // dead during the 10s BETTING window.
  const bob = Math.sin(Date.now() / 380) * 4;
  drawRocket(ctx, sprite, 70, h - 56 + bob, -0.12, 1);
}

function drawCrashed(
  ctx: CanvasRenderingContext2D,
  sprite: CanvasImageSource | null,
  w: number,
  h: number,
  rocketX: number,
  rocketY: number,
  multiplier: number,
) {
  // Red flash overlay.
  ctx.save();
  ctx.fillStyle = 'rgba(255, 77, 90, 0.08)';
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  if (sprite && rocketX > 0 && rocketY > 0) {
    drawRocket(ctx, sprite, rocketX, rocketY, Math.PI / 5, 1);
    drawLabel(ctx, rocketX, rocketY, `${multiplier.toFixed(2)}×`, TRAIL_FROM, w);
  }
}

export default function RocketStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rocketPosRef = useRef({ x: 0, y: 0 });
  const particlesRef = useRef<Particle[]>([]);
  const lastPhaseRef = useRef<string>('UNKNOWN');
  const lastFrameRef = useRef<number>(0);
  const spriteRef = useRef<CanvasImageSource | null>(null);

  const phase = useGame((s) => s.phase);
  const liveMultiplier = useGame((s) => s.multiplier);
  const lastCrash = useGame((s) => s.lastCrash);
  const bettingEndsAt = useGame((s) => s.bettingEndsAt);

  const [countdownSec, setCountdownSec] = useState(0);
  const [spriteReady, setSpriteReady] = useState(false);

  // One-shot SVG load + alpha pre-process. If it fails (e.g. the SVG
  // 404s), `spriteRef.current` stays null and the stage simply skips
  // drawing the rocket — better than throwing.
  useEffect(() => {
    let cancelled = false;
    void loadProcessedRocket().then((sprite) => {
      if (cancelled) return;
      spriteRef.current = sprite;
      setSpriteReady(!!sprite);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (phase !== 'BETTING' || !bettingEndsAt) return;
    const update = () =>
      setCountdownSec(Math.max(0, Math.ceil((bettingEndsAt - Date.now()) / 1000)));
    update();
    const id = setInterval(update, 250);
    return () => clearInterval(id);
  }, [phase, bettingEndsAt]);

  useEffect(() => {
    let raf = 0;

    function frame(ts: number) {
      const dt = lastFrameRef.current ? ts - lastFrameRef.current : 16;
      lastFrameRef.current = ts;

      const canvas = canvasRef.current;
      if (!canvas) {
        raf = requestAnimationFrame(frame);
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        raf = requestAnimationFrame(frame);
        return;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
        canvas.width = cssW * dpr;
        canvas.height = cssH * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      drawGrid(ctx, cssW, cssH);

      const state = useGame.getState();
      const currentPhase = state.phase;

      if (lastPhaseRef.current !== currentPhase) {
        if (currentPhase === 'CRASHED') {
          spawnCrashParticles(
            particlesRef.current,
            rocketPosRef.current.x,
            rocketPosRef.current.y,
          );
        } else if (currentPhase === 'BETTING') {
          particlesRef.current.length = 0;
          rocketPosRef.current = { x: 0, y: 0 };
        }
        lastPhaseRef.current = currentPhase;
      }

      const sprite = spriteRef.current;
      if (currentPhase === 'RUNNING' && state.startedAt && sprite) {
        const elapsed = Date.now() - state.startedAt;
        const r = drawCurveAndRocket(ctx, sprite, cssW, cssH, elapsed, state.multiplier);
        rocketPosRef.current = { x: r.rocketX, y: r.rocketY };
      } else if (currentPhase === 'CRASHED') {
        drawCrashed(
          ctx,
          sprite,
          cssW,
          cssH,
          rocketPosRef.current.x,
          rocketPosRef.current.y,
          state.lastCrash?.multiplier ?? 1,
        );
      } else if (sprite) {
        drawIdle(ctx, sprite, cssW, cssH);
      }

      updateAndDrawParticles(ctx, particlesRef.current, dt);

      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  void liveMultiplier;
  void lastCrash;
  void spriteReady;

  return (
    <div
      className="relative w-full overflow-hidden mx-auto"
      style={{ aspectRatio: 'var(--plane-aspect, 21 / 9)' }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />

      <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none select-none">
        {phase === 'BETTING' && (
          <div className="text-text-secondary text-xs uppercase tracking-[0.25em]">
            Bets close in {countdownSec}s
          </div>
        )}
        {phase === 'CRASHED' && (
          <div className="text-accent-red text-sm uppercase tracking-[0.3em] font-semibold">
            Crashed
          </div>
        )}
      </div>
    </div>
  );
}
