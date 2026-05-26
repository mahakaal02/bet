"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Product-detail carousel. Mirrors a shopping-site pattern: one large
 * hero, swipeable left/right, with a thumbnail strip below + chevron
 * controls + dot indicators. Implementation uses native CSS
 * scroll-snap so touch-swipe / drag-scroll / arrow keys "just work"
 * without a heavy carousel library.
 *
 *   - `scrollIntoView` is the only JS the dot strip + chevrons need —
 *     no animations to schedule, the browser handles smooth-scroll.
 *   - Active index is derived from the scroll position via an
 *     IntersectionObserver on each slide. Source of truth is the
 *     scroll container; React state is just a mirror for the indicator.
 *   - Auto-advance is intentionally not added: shopping-site carousels
 *     that animate without user input are widely loathed, and the
 *     auction page already has too many live things competing for
 *     attention (countdown, WS status). The user can swipe freely.
 */
export function ImageCarousel({
  title,
  images,
}: {
  title: string;
  images: string[];
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    // Each slide is exactly the container width; the slide closest to
    // the centre is the "active" one. IntersectionObserver with the
    // container as root reports each slide's visibility ratio — pick
    // the one most visible.
    const observer = new IntersectionObserver(
      (entries) => {
        let bestIdx = active;
        let bestRatio = 0;
        for (const e of entries) {
          if (e.intersectionRatio > bestRatio) {
            bestRatio = e.intersectionRatio;
            const idx = Number((e.target as HTMLElement).dataset.idx ?? "0");
            bestIdx = idx;
          }
        }
        if (bestRatio > 0.5) setActive(bestIdx);
      },
      { root: container, threshold: [0.5, 0.9, 1] },
    );
    slideRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
    // images is intentionally a stable input — the parent passes the
    // same array each render; we don't want to tear down the observer
    // unless the slide nodes themselves change.
  }, [active]);

  if (images.length === 0) {
    // Empty-state square is capped so an imageless auction doesn't
    // dominate the layout the way a 4:3 box did on wider viewports.
    return (
      <div className="mx-auto flex aspect-square w-full max-w-[420px] items-center justify-center rounded-xl border border-[var(--color-divider)] bg-slate-900 text-4xl text-slate-700">
        🛒
      </div>
    );
  }

  function scrollTo(idx: number) {
    const target = slideRefs.current[idx];
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  }

  const prev = () => scrollTo(Math.max(0, active - 1));
  const next = () => scrollTo(Math.min(images.length - 1, active + 1));

  return (
    <div className="mx-auto w-full max-w-[480px] space-y-2">
      {/* Hero strip — scroll-snap on the X axis, one slide per page.
          Amazon-style: square aspect, `object-contain` so portrait /
          landscape product photos both fit without cropping, soft
          backdrop. Width is capped so the image doesn't dominate the
          page on wide viewports. */}
      <div className="relative">
        <div
          ref={scrollRef}
          className="flex aspect-square w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden rounded-xl border border-[var(--color-divider)] bg-slate-900 [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: "none" }}
        >
          {images.map((src, i) => (
            <div
              key={src + i}
              data-idx={i}
              ref={(el) => {
                slideRefs.current[i] = el;
              }}
              className="relative aspect-square h-full w-full shrink-0 snap-center"
            >
              <Image
                src={src}
                alt={`${title} — image ${i + 1}`}
                fill
                sizes="(min-width: 768px) 480px, 100vw"
                className="object-contain"
                unoptimized
                priority={i === 0}
              />
            </div>
          ))}
        </div>

        {/* Chevron buttons — hidden when there's only one image so the
            single-photo case stays clean. */}
        {images.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous image"
              onClick={prev}
              disabled={active === 0}
              className="absolute left-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/40 text-white backdrop-blur transition hover:bg-black/60 disabled:opacity-30"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next image"
              onClick={next}
              disabled={active === images.length - 1}
              className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/40 text-white backdrop-blur transition hover:bg-black/60 disabled:opacity-30"
            >
              ›
            </button>

            {/* Dot indicators — purely visual, taps route through the
                same scrollTo helper. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
              {images.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Go to image ${i + 1}`}
                  onClick={() => scrollTo(i)}
                  className={cn(
                    "pointer-events-auto h-1.5 rounded-full transition-all",
                    i === active
                      ? "w-6 bg-white"
                      : "w-1.5 bg-white/40 hover:bg-white/60",
                  )}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Thumbnail strip — also tappable. Hidden on single-image. */}
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
          {images.map((src, i) => (
            <button
              key={src + "thumb" + i}
              type="button"
              onClick={() => scrollTo(i)}
              className={cn(
                "relative aspect-square h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition",
                i === active
                  ? "border-cyan-400"
                  : "border-[var(--color-divider)] hover:border-slate-500",
              )}
            >
              <Image
                src={src}
                alt={`${title} thumb ${i + 1}`}
                fill
                sizes="64px"
                className="object-cover"
                unoptimized
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
