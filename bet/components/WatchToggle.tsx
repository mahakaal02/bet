"use client";

import { useState, useTransition } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { toast } from "@/components/ui/Toaster";
import {
  DEFAULT_LOCALE,
  isLocale,
  splitLocaleFromPath,
  t,
  type Locale,
} from "@/lib/i18n";

export function WatchToggle({
  marketId,
  initial,
}: {
  marketId: string;
  initial: boolean;
}) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const params = useParams<{ locale?: string }>();
  const pathname = usePathname();
  const fromPath = splitLocaleFromPath(pathname ?? "/").locale;
  const locale: Locale = isLocale(params?.locale)
    ? params.locale
    : (fromPath ?? DEFAULT_LOCALE);
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);
  const [, startTransition] = useTransition();

  async function toggle() {
    const next = !on;
    setBusy(true);
    setOn(next); // optimistic
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketId, watching: next }),
      });
      if (!res.ok) throw new Error("save_failed");
      startTransition(() => router.refresh());
    } catch {
      setOn(!next); // rollback
      toast(tr("watchlist.couldntUpdate"), "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      // Toggle semantics: aria-pressed tells assistive tech that this
      // is a binary on/off control rather than a vanilla button. Saves
      // the user from having to re-read the label to figure out state.
      aria-pressed={on}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 ${
        on
          ? "border-amber-500/40 bg-amber-500/15 text-amber-200"
          : "border-slate-700 bg-slate-900/60 text-slate-400 hover:text-slate-200"
      }`}
    >
      <Star aria-hidden className={`h-3 w-3 ${on ? "fill-current" : ""}`} />
      {on ? tr("watchlist.watching") : tr("watchlist.watch")}
    </button>
  );
}
