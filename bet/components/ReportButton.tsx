"use client";

import { useEffect, useRef, useState } from "react";
import { Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";

interface Props {
  targetType: "COMMENT" | "MARKET";
  targetId: string;
  /** Hide the button entirely if the viewer is the author (self-report
   *  is rejected by the API anyway, but no point showing the affordance). */
  hidden?: boolean;
}

const PRESETS = [
  "Spam or off-topic",
  "Harassment or hate speech",
  "Misinformation",
  "Other",
];

/**
 * Small flag button that toggles a popover with preset + free-form reasons.
 * Submits to /api/reports; toasts on success.
 *
 * Closes on outside click, Escape, or successful submit. Defensive: if the
 * API responds with `duplicate: true` (idempotent re-report), we still treat
 * it as success so the user gets a confirmation without revealing whether
 * they'd previously reported the same item.
 */
export function ReportButton({ targetType, targetId, hidden }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(PRESETS[0]);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open]);

  if (hidden) return null;

  const finalReason = reason === "Other" ? custom.trim() : reason;
  const valid = finalReason.length >= 3 && finalReason.length <= 280;

  async function submit() {
    if (!valid) return;
    setBusy(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, targetId, reason: finalReason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(prettyError(body.error), "err");
        return;
      }
      toast(
        body.duplicate
          ? "You've already reported this. Thanks."
          : "Report submitted. Thanks.",
        "ok",
      );
      setOpen(false);
      setCustom("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1 rounded-md p-1 text-[10px] text-slate-500 transition hover:bg-slate-800 hover:text-slate-300",
          open && "bg-slate-800 text-slate-200",
        )}
        aria-label="Report this"
      >
        <Flag className="h-3 w-3" />
      </button>
      {open && (
        <div className="fade-up absolute right-0 z-20 mt-1 w-64 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/95 p-3 text-xs shadow-xl backdrop-blur">
          <div className="mb-2 font-semibold text-slate-200">Report — why?</div>
          <div className="space-y-1.5">
            {PRESETS.map((p) => (
              <label
                key={p}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-slate-300 hover:bg-slate-900"
              >
                <input
                  type="radio"
                  name={`report-${targetId}`}
                  value={p}
                  checked={reason === p}
                  onChange={() => setReason(p)}
                  className="accent-cyan-400"
                />
                {p}
              </label>
            ))}
          </div>
          {reason === "Other" && (
            <input
              autoFocus
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Brief description (3–280 chars)"
              maxLength={280}
              className="mt-2 h-8 w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 text-xs"
            />
          )}
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              onClick={submit}
              disabled={!valid || busy}
              className="flex-1"
            >
              {busy ? "Sending…" : "Submit"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function prettyError(code?: string): string {
  switch (code) {
    case "self_report":
      return "You can't report your own content.";
    case "not_found":
      return "That content doesn't exist anymore.";
    case "rate_limited":
      return "Too many reports — wait a bit before filing another.";
    case "unauthorized":
      return "Please sign in to report.";
    default:
      return "Could not submit report.";
  }
}
