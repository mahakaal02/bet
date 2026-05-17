"use client";

import { useState } from "react";
import { Check, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/Toaster";

interface Props {
  /** URL to share. If omitted, the current location is used at click time. */
  url?: string;
  /** Shown by the native share sheet / fallback toast. */
  title?: string;
  /** Body text included in the native share payload. */
  text?: string;
  /** Tailwind classes to override the default chip styling. */
  className?: string;
}

/**
 * Share chip. Prefers the native Web Share API (mobile + recent desktop
 * browsers), falls back to clipboard copy with a "Copied!" confirmation.
 * Either way the action surfaces a toast so the user knows it worked.
 *
 * The button is a `<button>` not a link so it never opens a new tab; the
 * caller decides what `url` means (default: `window.location.href`).
 */
export function ShareButton({
  url,
  title,
  text,
  className,
}: Props) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    const href = url ?? (typeof window !== "undefined" ? window.location.href : "");
    if (!href) return;

    // navigator.share is the natural UX on mobile (opens the system share
    // sheet). Some desktop browsers also support it. canShare() guards
    // against environments where the API exists but rejects the payload.
    const nav = typeof navigator !== "undefined" ? navigator : null;
    const shareData = { title, text, url: href };
    if (nav?.share && (!nav.canShare || nav.canShare(shareData))) {
      try {
        await nav.share(shareData);
        toast("Shared.", "ok");
        return;
      } catch (err: unknown) {
        // AbortError = user cancelled the share sheet — silent dismiss.
        if (err instanceof Error && err.name === "AbortError") return;
        // Anything else: fall through to clipboard.
      }
    }

    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast("Link copied to clipboard.", "ok");
    } catch {
      toast("Couldn't copy — your browser blocked clipboard access.", "err");
    }
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 transition hover:text-slate-200",
        className,
      )}
      aria-label="Share this market"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-emerald-400" />
          Copied
        </>
      ) : (
        <>
          <Share2 className="h-3 w-3" />
          Share
        </>
      )}
    </button>
  );
}
