"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toaster";

interface Props {
  reportId: string;
  targetType: "COMMENT" | "MARKET";
  targetId: string;
  /** Whether the target comment is still visible (false = already hidden). */
  canHide: boolean;
}

/**
 * Per-row action strip on /admin/reports. Three paths:
 *
 *   - Resolve + hide  → flips Comment.hidden + RESOLVES the report AND
 *                       auto-RESOLVES other PENDING reports on the same
 *                       comment (so the queue collapses to one decision).
 *   - Resolve         → just marks RESOLVED with an optional note. Use when
 *                       the content was edited / fixed / not actionable
 *                       enough to delete.
 *   - Dismiss         → marks DISMISSED. No content change.
 */
export function ReportRowActions({
  reportId,
  targetType,
  canHide,
}: Props) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function call(action: "resolve" | "dismiss", hideTarget = false) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/reports/${reportId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          note: note.trim() || undefined,
          hideTarget,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(body.error ?? "Action failed.", "err");
        return;
      }
      toast(
        action === "resolve"
          ? hideTarget
            ? "Resolved and content hidden."
            : "Resolved."
          : "Dismissed.",
        "ok",
      );
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Internal note (optional, 280 char)"
        maxLength={280}
        disabled={busy}
      />
      <div className="flex flex-wrap gap-2">
        {targetType === "COMMENT" && canHide && (
          <Button
            variant="danger"
            size="sm"
            disabled={busy}
            onClick={() => call("resolve", true)}
          >
            Hide content + resolve
          </Button>
        )}
        <Button
          variant="yes"
          size="sm"
          disabled={busy}
          onClick={() => call("resolve", false)}
        >
          Resolve
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => call("dismiss")}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
