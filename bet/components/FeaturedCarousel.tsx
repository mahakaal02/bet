"use client";

import { useRef } from "react";
import Link from "next/link";
import { Sparkles, ChevronLeft, ChevronRight } from "lucide-react";
import { priceYes } from "@/lib/amm";
import { cn, fmtCoins, fmtPrice } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";

interface Market {
  id: string;
  slug: string;
  title: string;
  category: string;
  bannerUrl: string | null;
  yesShares: number;
  noShares: number;
  volumeCoins: number;
  endsAt: string | Date;
}

interface Props {
  markets: Market[];
}

/**
 * Hero rail of featured markets. Bigger cards than the "Trending" grid, with
 * banner images and inline arrow controls. Snap-scrolls horizontally on
 * touch; desktop gets clickable chevrons that scroll one card width at a
 * time. Hidden entirely if there are no featured markets.
 */
export function FeaturedCarousel({ markets }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  if (markets.length === 0) return null;

  const scrollBy = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    // Step one card-width (≈ 320px on mobile, 360px on desktop).
    const step = Math.min(420, el.clientWidth * 0.85);
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  };

  return (
    <section className="mx-auto max-w-7xl px-4 pb-12">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <Sparkles className="h-5 w-5 text-amber-300" /> Featured
        </h2>
        {markets.length > 1 && (
          <div className="hidden gap-1 md:flex">
            <button
              onClick={() => scrollBy(-1)}
              className="rounded-lg border border-slate-700 bg-slate-900/60 p-1.5 text-slate-300 hover:bg-slate-800"
              aria-label="Scroll left"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => scrollBy(1)}
              className="rounded-lg border border-slate-700 bg-slate-900/60 p-1.5 text-slate-300 hover:bg-slate-800"
              aria-label="Scroll right"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div
        ref={scrollerRef}
        // snap-mandatory locks each card to the start on touch flicks. Hide
        // the scrollbar to keep the premium feel — overflow is still touch-
        // scrollable on every browser via the wheel/swipe.
        className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ scrollSnapType: "x mandatory" }}
      >
        {markets.map((m) => {
          const yes = priceYes({ yesShares: m.yesShares, noShares: m.noShares });
          return (
            <Link
              key={m.id}
              href={`/markets/${m.slug}`}
              className="group min-w-[280px] flex-shrink-0 basis-[280px] sm:min-w-[340px] sm:basis-[340px]"
              style={{ scrollSnapAlign: "start" }}
            >
              <article
                className={cn(
                  "fade-up relative h-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40",
                  "transition hover:border-cyan-500/40 hover:shadow-lg hover:shadow-cyan-500/10",
                )}
              >
                {/* Banner */}
                <div className="relative h-36 overflow-hidden bg-slate-800">
                  {m.bannerUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.bannerUrl}
                      alt=""
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-full w-full bg-gradient-to-br from-cyan-500/20 via-indigo-500/10 to-slate-900" />
                  )}
                  {/* Bottom-fade so the banner blends into the card body. */}
                  <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-900 to-transparent" />
                  <div className="absolute left-3 top-3 flex gap-1.5">
                    <Badge tone="warn">
                      <Sparkles className="h-3 w-3" /> Featured
                    </Badge>
                    <Badge>{m.category}</Badge>
                  </div>
                </div>

                <div className="p-4">
                  <h3 className="line-clamp-2 min-h-[2.5rem] text-base font-bold text-slate-100">
                    {m.title}
                  </h3>
                  <div className="mt-3 flex items-center justify-between">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">
                        YES
                      </div>
                      <div className="text-2xl font-black text-emerald-300">
                        {fmtPrice(yes)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">
                        NO
                      </div>
                      <div className="text-2xl font-black text-rose-300">
                        {fmtPrice(1 - yes)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
                    <span>Vol {fmtCoins(m.volumeCoins)}</span>
                    <span>
                      Ends {new Date(m.endsAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                </div>
              </article>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
