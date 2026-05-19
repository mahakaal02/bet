'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGame } from '@/lib/store';

/**
 * Astronaut-on-rocket stage. Drop-in replacement for `PlaneStage`,
 * gated behind the `NEXT_PUBLIC_AVIATOR_ROCKET=1` env flag (handled
 * by the parent Stage wrapper).
 *
 * # Why SVG + framer-motion (vs. canvas like PlaneStage)
 *
 * The licensed art is a vector with 8 colour-region paths — auto-traced
 * by Magnific, so the smile / eyes / exhaust aren't separately named
 * paths we can grab. Inline SVG manipulation is therefore limited to
 * whole-image transforms. We get "make it alive" by **overlaying**
 * animated elements on top of the static SVG at hand-tuned positions
 * inside the 1024×1024 viewBox:
 *
 *   - **Smile**: a small `<path>` overlay over the boy's mouth that
 *     bounces, widens, and (on crash) flips to a frown.
 *   - **Exhaust**: framer-motion particle puffs emitted from the rocket
 *     nozzle, falling-and-fading. Separate from the SVG's static smoke
 *     cloud — we keep that as the "base" puff and trail new particles
 *     out of the bottom.
 *
 * # Phase-driven motion
 *
 *   - BETTING : rocket bobs in the lower-left (idle). Subtle smile
 *               breathing. Slow drifting exhaust.
 *   - RUNNING : rocket climbs an arc keyed off the live multiplier
 *               (same exponential curve the canvas uses). Smile wider.
 *               Exhaust spawns faster, hotter.
 *   - CRASHED : rocket tilts forward and falls. Smile flips to frown.
 *               Exhaust sputters off.
 */

// Hand-tuned coordinates inside the SVG's 1024×1024 viewBox. If the
// art changes, retune these — they're the anchor points for the
// animated overlays.
const VIEW = 1024;
const SMILE = { cx: 803, cy: 220, w: 28, h: 10 };
const NOZZLE = { x: 410, y: 950 };

// Same multiplier curve the server emits (`backend/src/aviator/fairness.ts`)
// — local copy so the visual updates every frame without waiting for a
// MULTIPLIER_UPDATE tick.
function multiplierAt(elapsedMs: number) {
  if (elapsedMs <= 0) return 1.0;
  return Math.pow(1.0024, elapsedMs / 10);
}

interface ExhaustParticle {
  id: number;
  /** Initial x within the viewBox (variation around NOZZLE.x). */
  x: number;
  /** Random horizontal drift while falling. */
  drift: number;
  /** Random size in viewBox units. */
  size: number;
  /** Variation in fade duration. */
  duration: number;
  /** "smoke" (white puff) or "flame" (orange). */
  kind: 'smoke' | 'flame';
}

export default function RocketStage() {
  const phase = useGame((s) => s.phase);
  const bettingEndsAt = useGame((s) => s.bettingEndsAt);
  const lastCrashMultiplier = useGame((s) => s.lastCrash?.multiplier ?? 1);

  const [countdownSec, setCountdownSec] = useState(0);
  const [liveMultiplier, setLiveMultiplier] = useState(1);
  const [particles, setParticles] = useState<ExhaustParticle[]>([]);
  const particleIdRef = useRef(0);

  // BETTING phase countdown — 4× per second is enough.
  useEffect(() => {
    if (phase !== 'BETTING' || !bettingEndsAt) return;
    const update = () =>
      setCountdownSec(Math.max(0, Math.ceil((bettingEndsAt - Date.now()) / 1000)));
    update();
    const id = setInterval(update, 250);
    return () => clearInterval(id);
  }, [phase, bettingEndsAt]);

  // RUNNING phase: re-compute the live multiplier off the round's
  // startedAt at 60Hz. Reads the store on every frame so we don't have
  // to re-subscribe to React state for the elapsed time itself.
  useEffect(() => {
    if (phase !== 'RUNNING') {
      setLiveMultiplier(1);
      return;
    }
    let raf = 0;
    const tick = () => {
      const state = useGame.getState();
      if (state.phase === 'RUNNING' && state.startedAt) {
        setLiveMultiplier(multiplierAt(Date.now() - state.startedAt));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // Particle emitter. Frequency depends on phase: BETTING drips,
  // RUNNING streams, CRASHED stops. Old particles are pruned by their
  // own fade animation's onAnimationComplete handler.
  useEffect(() => {
    if (phase === 'CRASHED') return;
    const interval = phase === 'RUNNING' ? 90 : 220;
    const id = setInterval(() => {
      setParticles((prev) => {
        const id = particleIdRef.current++;
        const next: ExhaustParticle = {
          id,
          x: NOZZLE.x + (Math.random() - 0.5) * 30,
          drift: (Math.random() - 0.4) * 80,
          size: phase === 'RUNNING' ? 26 + Math.random() * 18 : 18 + Math.random() * 10,
          duration: 0.9 + Math.random() * 0.7,
          kind: Math.random() < 0.25 ? 'flame' : 'smoke',
        };
        // Cap at 24 to avoid runaway state if the cleanup callback
        // ever misfires (e.g. component unmounts mid-animation).
        const trimmed = prev.length > 24 ? prev.slice(prev.length - 24) : prev;
        return [...trimmed, next];
      });
    }, interval);
    return () => clearInterval(id);
  }, [phase]);

  // Position of the rocket as the round progresses. BETTING/IDLE: bob
  // near the bottom-left. RUNNING: trace an arc into the upper-right
  // keyed off the live multiplier. CRASHED: dive forward.
  const rocketTransform = computeRocketTransform(phase, liveMultiplier);

  return (
    <div
      className="relative w-full overflow-hidden mx-auto bg-gradient-to-b from-[#0a0e2a] via-[#161e4d] to-[#1f2a6b]"
      // Slightly more square than the plane stage so the rocket has
      // vertical headroom for the climb.
      style={{ aspectRatio: 'var(--plane-aspect, 4 / 3)' }}
    >
      {/* Subtle starfield — purely cosmetic, doesn't animate per-frame.
          A handful of static `<div>` dots is cheaper than a canvas. */}
      <Starfield />

      {/* The viewport — a 1024×1024 SVG canvas with the rocket art and
          all animated overlays inside. preserveAspectRatio centres it
          inside whatever parent rectangle the stage occupies. */}
      <svg
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 w-full h-full"
      >
        {/* Exhaust particles render BEHIND the rocket so the trail
            looks like it's coming out the back. */}
        <g>
          <AnimatePresence>
            {particles.map((p) => (
              <ExhaustParticleNode
                key={p.id}
                particle={p}
                onComplete={() =>
                  setParticles((prev) => prev.filter((x) => x.id !== p.id))
                }
              />
            ))}
          </AnimatePresence>
        </g>

        {/* The rocket itself — base SVG (referenced via <image>) plus
            a smile overlay positioned over the boy's mouth. The whole
            group is the unit that climbs / falls / bobs. */}
        <motion.g
          style={{ originX: 0.5, originY: 0.5 }}
          animate={rocketTransform.animate}
          transition={rocketTransform.transition}
        >
          <motion.g
            // Continuous bob while alive. Stops on CRASHED.
            animate={
              phase === 'CRASHED'
                ? {}
                : { y: [0, -8, 0, 6, 0] }
            }
            transition={{
              duration: 2.2,
              repeat: phase === 'CRASHED' ? 0 : Infinity,
              ease: 'easeInOut',
            }}
          >
            <image
              href="/astro-rocket.svg"
              x={0}
              y={0}
              width={VIEW}
              height={VIEW}
              preserveAspectRatio="xMidYMid meet"
            />
            <SmileOverlay phase={phase} />
          </motion.g>
        </motion.g>
      </svg>

      {/* Live multiplier overlay — large, centered on top of the
          scene. Colour shifts to red on crash. */}
      <MultiplierBadge phase={phase} multiplier={liveMultiplier} crashed={lastCrashMultiplier} />

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

// ── Smile overlay ────────────────────────────────────────────────────────────

function SmileOverlay({ phase }: { phase: 'BETTING' | 'RUNNING' | 'CRASHED' | string }) {
  // Three states for the same anchor point:
  //   BETTING  — gentle resting smile, subtle breathing.
  //   RUNNING  — big grin (taller curve), faster bounce.
  //   CRASHED  — flip the curve into a frown.
  const { d, dKey } =
    phase === 'CRASHED'
      ? {
          d: `M ${SMILE.cx - SMILE.w} ${SMILE.cy + SMILE.h / 2} Q ${SMILE.cx} ${
            SMILE.cy - SMILE.h
          } ${SMILE.cx + SMILE.w} ${SMILE.cy + SMILE.h / 2}`,
          dKey: 'frown',
        }
      : phase === 'RUNNING'
        ? {
            d: `M ${SMILE.cx - SMILE.w} ${SMILE.cy} Q ${SMILE.cx} ${
              SMILE.cy + SMILE.h * 2.4
            } ${SMILE.cx + SMILE.w} ${SMILE.cy}`,
            dKey: 'grin',
          }
        : {
            d: `M ${SMILE.cx - SMILE.w * 0.85} ${SMILE.cy} Q ${SMILE.cx} ${
              SMILE.cy + SMILE.h * 1.4
            } ${SMILE.cx + SMILE.w * 0.85} ${SMILE.cy}`,
            dKey: 'smile',
          };

  return (
    <motion.path
      key={dKey}
      d={d}
      stroke="rgb(44,38,32)"
      strokeWidth={3.5}
      strokeLinecap="round"
      fill="none"
      animate={
        phase === 'CRASHED'
          ? { scale: [1, 0.95, 1] }
          : { scaleY: [1, 1.15, 1] }
      }
      transition={{
        duration: phase === 'RUNNING' ? 0.6 : 1.4,
        repeat: phase === 'CRASHED' ? 0 : Infinity,
        ease: 'easeInOut',
      }}
      style={{ originX: SMILE.cx, originY: SMILE.cy, transformOrigin: `${SMILE.cx}px ${SMILE.cy}px` }}
    />
  );
}

// ── Exhaust particle ─────────────────────────────────────────────────────────

function ExhaustParticleNode({
  particle: p,
  onComplete,
}: {
  particle: ExhaustParticle;
  onComplete: () => void;
}) {
  const isFlame = p.kind === 'flame';
  return (
    <motion.circle
      cx={p.x}
      cy={NOZZLE.y}
      r={p.size}
      fill={isFlame ? 'rgb(255, 140, 66)' : 'rgba(240, 240, 250, 0.85)'}
      initial={{ opacity: 0.9, scale: 0.6 }}
      animate={{
        cx: p.x + p.drift,
        cy: NOZZLE.y + 220,
        scale: isFlame ? 0.4 : 1.4,
        opacity: 0,
      }}
      transition={{ duration: p.duration, ease: 'easeOut' }}
      onAnimationComplete={onComplete}
    />
  );
}

// ── Rocket transform per phase ───────────────────────────────────────────────

function computeRocketTransform(
  phase: string,
  liveMultiplier: number,
): { animate: Record<string, unknown>; transition: Record<string, unknown> } {
  if (phase === 'CRASHED') {
    return {
      animate: { x: 60, y: 220, rotate: 35, scale: 0.85 },
      transition: { duration: 0.9, ease: 'easeIn' },
    };
  }
  if (phase === 'RUNNING') {
    // The same exponential curve the canvas uses for the trail line,
    // but mapped onto a screen position. We want the rocket to march
    // up-and-right as the multiplier grows. The clamp keeps the rocket
    // visible even at extreme multipliers.
    const t = Math.min(Math.log(liveMultiplier) / Math.log(20), 1); // 0..1 as 1× → 20×
    const x = -200 + t * 380;
    const y = 220 - t * 360;
    const rotate = -15 - t * 18;
    return {
      animate: { x, y, rotate, scale: 0.65 + t * 0.1 },
      transition: { type: 'tween', ease: 'linear', duration: 0.12 },
    };
  }
  // BETTING / unknown / idle: bottom-left, slightly tilted up.
  return {
    animate: { x: -240, y: 180, rotate: -12, scale: 0.55 },
    transition: { duration: 0.6, ease: 'easeOut' },
  };
}

// ── Multiplier badge ─────────────────────────────────────────────────────────

function MultiplierBadge({
  phase,
  multiplier,
  crashed,
}: {
  phase: string;
  multiplier: number;
  crashed: number;
}) {
  if (phase === 'BETTING') return null;
  const display = phase === 'CRASHED' ? crashed : multiplier;
  return (
    <div
      className={`absolute inset-x-0 top-1/3 -translate-y-1/2 flex justify-center pointer-events-none select-none transition-colors ${
        phase === 'CRASHED' ? 'text-accent-red' : 'text-white'
      }`}
    >
      <div className="font-mono text-5xl font-bold drop-shadow-[0_0_18px_rgba(255,140,66,0.6)]">
        {display.toFixed(2)}×
      </div>
    </div>
  );
}

// ── Starfield ────────────────────────────────────────────────────────────────

function Starfield() {
  // Hardcoded star positions so SSR + CSR match (Math.random in
  // render would cause hydration mismatch). Static positions render
  // fast and look perfectly fine.
  const stars = [
    [8, 12], [22, 32], [37, 11], [54, 25], [68, 18], [82, 38], [94, 14],
    [5, 56], [18, 72], [33, 64], [49, 80], [62, 70], [77, 58], [90, 72],
    [15, 88], [40, 92], [67, 88], [85, 86], [50, 45], [73, 30],
  ];
  return (
    <div className="absolute inset-0 pointer-events-none">
      {stars.map(([x, y], i) => (
        <span
          key={i}
          className="absolute h-1 w-1 rounded-full bg-white/70"
          style={{ left: `${x}%`, top: `${y}%`, opacity: 0.5 + ((i * 37) % 5) / 10 }}
        />
      ))}
    </div>
  );
}
