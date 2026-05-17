"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Brand mark + wordmark used in the navbar and on auth pages. The logo is
 * served from `public/logo.png` (or `.svg` — rename and adjust LOGO_PATH).
 *
 * If the file is missing, the `onError` handler hides the broken `<img>`
 * and the fallback layer (gradient tile + "K" initial) shows through.
 * This lets the brand render cleanly before a designer has produced the
 * final asset — no broken-image glyph ever appears.
 */
const LOGO_PATH = "/logo.png";

export const BRAND_NAME = "Kalki Exchange";

interface BrandProps {
  /** size in pixels for the logo tile. Default 32 (navbar). */
  size?: number;
  /** Hide the wordmark — useful on cramped layouts. */
  iconOnly?: boolean;
  className?: string;
}

export function Brand({ size = 32, iconOnly = false, className }: BrandProps) {
  const [hasImg, setHasImg] = useState(true);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className="relative grid place-items-center overflow-hidden rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 font-black text-slate-950"
        style={{ width: size, height: size, fontSize: size * 0.5 }}
      >
        {/* Fallback layer (always rendered, behind the image). */}
        <span aria-hidden>K</span>
        {hasImg && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={LOGO_PATH}
            alt={BRAND_NAME}
            className="absolute inset-0 h-full w-full object-contain"
            onError={() => setHasImg(false)}
          />
        )}
      </div>
      {!iconOnly && (
        <div className="hidden sm:block">
          <div className="text-sm font-bold gradient-accent">{BRAND_NAME}</div>
        </div>
      )}
    </div>
  );
}
