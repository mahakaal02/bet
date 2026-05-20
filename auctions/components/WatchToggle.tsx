"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Star-shaped watch toggle for an auction. Renders nothing if the
 * visitor isn't signed in — the parent server component decides
 * whether to mount this at all (no flash of unstyled state).
 *
 * Initial `watching` state is supplied by the parent so the first
 * paint is correct. Subsequent toggles fire `POST/DELETE
 * /api/watchlist/:id` and optimistically flip the star; failures
 * revert + surface a small inline message.
 *
 * Compact variant for grid tiles: `compact` shrinks to an unstyled
 * 32×32 icon with no label. The full variant carries the textual
 * affordance "Watch" / "Watching" alongside.
 */
export function WatchToggle({
  auctionId,
  initialWatching,
  compact = false,
}: {
  auctionId: string;
  initialWatching: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [watching, setWatching] = useState(initialWatching);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (busy) return;
    const next = !watching;
    setBusy(true);
    setError(null);
    // Optimistic flip.
    setWatching(next);
    try {
      const res = await fetch(`/api/watchlist/${auctionId}`, {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Couldn't update watchlist.");
      }
      // Refresh server components reading watchlist counts (e.g. the
      // /me/watchlist page if the user navigates back).
      router.refresh();
    } catch (e) {
      // Revert optimistic state.
      setWatching(!next);
      setError(e instanceof Error ? e.message : "Couldn't update watchlist.");
    } finally {
      setBusy(false);
    }
  }

  const label = watching ? "Watching" : "Watch";
  const ariaLabel = watching
    ? `Stop watching this auction`
    : `Watch this auction`;

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-label={ariaLabel}
        aria-pressed={watching}
        className={`grid h-9 w-9 place-items-center rounded-lg border transition ${
          watching
            ? "border-amber-400/50 bg-amber-400/10 text-amber-200"
            : "border-slate-700 bg-slate-900/60 text-slate-400 hover:border-amber-400/40 hover:text-amber-200"
        } disabled:opacity-50`}
      >
        <Star filled={watching} />
      </button>
    );
  }

  return (
    <div className="inline-flex flex-col items-stretch gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-label={ariaLabel}
        aria-pressed={watching}
        className={`inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-sm font-semibold transition disabled:opacity-50 ${
          watching
            ? "border-amber-400/50 bg-amber-400/10 text-amber-200 hover:bg-amber-400/15"
            : "border-slate-700 bg-slate-900/60 text-slate-200 hover:border-amber-400/40 hover:text-amber-100"
        }`}
      >
        <Star filled={watching} />
        <span>{busy ? "…" : label}</span>
      </button>
      {error && (
        <span className="text-[11px] text-rose-300">{error}</span>
      )}
    </div>
  );
}

function Star({ filled }: { filled: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}
