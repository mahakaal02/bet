'use client';

import { useEffect, useRef, useState } from 'react';
import { useGame } from '@/lib/store';

// Same multiplier curve as the server (`backend/src/aviator/fairness.ts`).
// Kept local so the canvas can render frames without waiting for the next
// MULTIPLIER_UPDATE tick.
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
const COLOR_AXIS = 'rgba(170, 179, 204, 0.18)';
const PLANE_FILL = '#F5F7FF';
const TRAIL_FROM = '#FF4D5A';
const TRAIL_TO = '#FF8C42';

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

function drawPlane(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  scale = 1,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);

  // Slight drop shadow
  ctx.shadowColor = 'rgba(255, 140, 66, 0.6)';
  ctx.shadowBlur = 12;

  ctx.fillStyle = PLANE_FILL;
  // Fuselage
  ctx.beginPath();
  ctx.moveTo(-16, -3);
  ctx.lineTo(10, -3);
  ctx.lineTo(18, 0);
  ctx.lineTo(10, 3);
  ctx.lineTo(-16, 3);
  ctx.closePath();
  ctx.fill();

  // Upper wing
  ctx.beginPath();
  ctx.moveTo(-6, -2);
  ctx.lineTo(0, -12);
  ctx.lineTo(6, -2);
  ctx.closePath();
  ctx.fill();

  // Lower wing
  ctx.beginPath();
  ctx.moveTo(-6, 2);
  ctx.lineTo(0, 12);
  ctx.lineTo(6, 2);
  ctx.closePath();
  ctx.fill();

  // Tail fin
  ctx.beginPath();
  ctx.moveTo(-14, -2);
  ctx.lineTo(-20, -8);
  ctx.lineTo(-10, -2);
  ctx.closePath();
  ctx.fill();

  // Cockpit highlight
  ctx.fillStyle = 'rgba(255, 140, 66, 0.85)';
  ctx.beginPath();
  ctx.arc(4, 0, 2.5, 0, Math.PI * 2);
  ctx.fill();

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
      vy: Math.sin(angle) * speed - 40, // slight upward kick
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
    p.vy += 320 * dtSec; // gravity
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
  planeX: number;
  planeY: number;
  angle: number;
}

function drawPlaneLabel(
  ctx: CanvasRenderingContext2D,
  planeX: number,
  planeY: number,
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
  const padY = 5;
  const boxW = textW + padX * 2;
  const boxH = 28;

  // Anchor: 26px to the right of the plane, vertically centered. Flip below
  // the plane if it would clip the top edge; flip to the left side of the
  // plane if it would overflow the right edge of the canvas.
  let bx = planeX + 26;
  let by = planeY - boxH / 2 - 4;
  if (bx + boxW > canvasW - 8) bx = planeX - 26 - boxW;
  if (by < 6) by = planeY + 12;

  // Rounded background for legibility against the gradient fill
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

  // Text with neon glow
  ctx.fillStyle = textColor;
  ctx.shadowColor = textColor;
  ctx.shadowBlur = 10;
  ctx.fillText(text, bx + padX, by + boxH / 2);
  ctx.restore();
  void padY; // (reserved for future vertical tuning)
}

function drawCurveAndPlane(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  elapsedMs: number,
  currentMultiplier: number,
): DrawCurveResult {
  const padding = { top: 36, bottom: 28, left: 28, right: 48 };
  const drawW = w - padding.left - padding.right;
  const drawH = h - padding.top - padding.bottom;

  // The visible time window grows so the plane stays near the front edge.
  const T_VIEW_MS = Math.max(8_000, elapsedMs + 1_200);
  // Multiplier view ceiling — expand by ~30% past current to leave headroom.
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

  // 1. Glow fill under curve
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

  // 2. Trail stroke (gradient + glow)
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

  // 3. Plane at the leading edge, rotated to the local tangent
  const [px, py] = last;
  const prev = points[points.length - 2] ?? last;
  const angle = Math.atan2(py - prev[1], px - prev[0]);
  drawPlane(ctx, px, py, angle, 1.25);

  // Multiplier pill travelling with the plane.
  drawPlaneLabel(ctx, px, py, `${currentMultiplier.toFixed(2)}×`, TRAIL_TO, w);

  return { planeX: px, planeY: py, angle };
}

function drawIdle(ctx: CanvasRenderingContext2D, w: number, h: number) {
  // A plane gently bobbing at the bottom-left while we wait for the round.
  const bob = Math.sin(Date.now() / 380) * 4;
  drawPlane(ctx, 56, h - 48 + bob, -0.12, 1.1);
}

function drawCrashed(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  planeX: number,
  planeY: number,
  multiplier: number,
) {
  // Red overlay flash
  ctx.save();
  ctx.fillStyle = 'rgba(255, 77, 90, 0.08)';
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  if (planeX > 0 && planeY > 0) {
    drawPlane(ctx, planeX, planeY, Math.PI / 5, 1.25);
    drawPlaneLabel(ctx, planeX, planeY, `${multiplier.toFixed(2)}×`, TRAIL_FROM, w);
  }
}

export default function PlaneStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const planePosRef = useRef({ x: 0, y: 0 });
  const particlesRef = useRef<Particle[]>([]);
  const lastPhaseRef = useRef<string>('UNKNOWN');
  const lastFrameRef = useRef<number>(0);

  const phase = useGame((s) => s.phase);
  const liveMultiplier = useGame((s) => s.multiplier);
  const lastCrash = useGame((s) => s.lastCrash);
  const bettingEndsAt = useGame((s) => s.bettingEndsAt);

  const [countdownSec, setCountdownSec] = useState(0);

  // Countdown text — updates 4× per second, doesn't drive the canvas.
  useEffect(() => {
    if (phase !== 'BETTING' || !bettingEndsAt) return;
    const update = () => setCountdownSec(Math.max(0, Math.ceil((bettingEndsAt - Date.now()) / 1000)));
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
      const ctx = canvas.getContext('2d')!;
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

      // Phase transition side-effects.
      if (lastPhaseRef.current !== currentPhase) {
        if (currentPhase === 'CRASHED') {
          spawnCrashParticles(
            particlesRef.current,
            planePosRef.current.x,
            planePosRef.current.y,
          );
        } else if (currentPhase === 'BETTING') {
          particlesRef.current.length = 0;
          planePosRef.current = { x: 0, y: 0 };
        }
        lastPhaseRef.current = currentPhase;
      }

      if (currentPhase === 'RUNNING' && state.startedAt) {
        const elapsed = Date.now() - state.startedAt;
        const r = drawCurveAndPlane(ctx, cssW, cssH, elapsed, state.multiplier);
        planePosRef.current = { x: r.planeX, y: r.planeY };
      } else if (currentPhase === 'CRASHED') {
        drawCrashed(
          ctx,
          cssW,
          cssH,
          planePosRef.current.x,
          planePosRef.current.y,
          state.lastCrash?.multiplier ?? 1,
        );
      } else {
        drawIdle(ctx, cssW, cssH);
      }

      updateAndDrawParticles(ctx, particlesRef.current, dt);

      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // The big centered multiplier was removed: the only multiplier display is
  // the one travelling with the plane on the canvas. Keep only the small
  // phase banner (countdown / crashed label) as HTML overlay.
  void liveMultiplier; void lastCrash;

  return (
    <div
      className="relative w-full overflow-hidden mx-auto"
      // Tighter aspect on mobile so the bet + wallet rows are above the fold.
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
