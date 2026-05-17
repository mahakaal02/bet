"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  src?: string | null;
  /** Used to compute the initial when no image is set. */
  name?: string | null;
  size?: number;
  className?: string;
  /** Cache-buster — pass a timestamp/etag so a freshly-uploaded avatar shows
   *  immediately instead of the browser-cached old one. */
  bust?: string | number;
}

/**
 * Square-ish user avatar with three layers:
 *
 *   1. Gradient tile + first-letter initial (always rendered, behind).
 *   2. The uploaded image, if `src` is set.
 *   3. `onError` un-mounts the image when the file is missing / 404s,
 *      revealing the initial layer cleanly — no broken-image glyph.
 *
 * Same fallback pattern as Brand.tsx — different visual: rounded-full,
 * sized by prop.
 */
export function Avatar({ src, name, size = 32, className, bust }: Props) {
  const [hasImg, setHasImg] = useState(!!src);
  const initial = (name?.trim()?.[0] ?? "?").toUpperCase();
  // Browsers cache aggressively on the public/ path; appending a busting
  // query string flushes the cache when an avatar is replaced.
  const url = src && bust ? `${src}?v=${bust}` : src ?? undefined;

  return (
    <div
      className={cn(
        "relative grid place-items-center overflow-hidden rounded-full bg-gradient-to-br from-cyan-400 to-indigo-500 font-black text-slate-950",
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      <span aria-hidden>{initial}</span>
      {hasImg && url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={name ? `${name}'s avatar` : "Avatar"}
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setHasImg(false)}
        />
      )}
    </div>
  );
}
