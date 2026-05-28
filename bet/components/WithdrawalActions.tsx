"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toaster";

interface Props {
  id: string;
  status: "PENDING" | "APPROVED";
}

/**
 * Per-row action strip on /admin/withdrawals.
 *
 *   PENDING  → Approve / Reject
 *   APPROVED → Mark paid (requires a payout reference)
 *
 * Each action submits to POST /api/admin/withdrawals/[id] with the matching
 * verb. The server enforces the state machine; this UI just narrows the
 * affordances based on current status.
 */
export function WithdrawalActions({ id, status }: Props) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [paidRef, setPaidRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function call(action: "approve" | "reject" | "mark_paid") {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/withdrawals/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          note: note.trim() || undefined,
          paidReference: action === "mark_paid" ? paidRef.trim() : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(prettyError(body.error), "err");
        return;
      }
      toast(
        action === "approve"
          ? "Approved — process the payout externally, then mark paid."
          : action === "reject"
            ? "Rejected — coins refunded."
            : "Marked paid.",
        "ok",
      );
      setNote("");
      setPaidRef("");
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 md:w-72">
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (visible to the user, optional)"
        maxLength={280}
        disabled={busy}
      />
      {status === "PENDING" ? (
        <div className="flex gap-2">
          <Button
            variant="yes"
            size="sm"
            disabled={busy}
            onClick={() => call("approve")}
            className="flex-1"
          >
            Approve
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={busy}
            onClick={() => call("reject")}
            className="flex-1"
          >
            Reject
          </Button>
        </div>
      ) : (
        <>
          <Input
            value={paidRef}
            onChange={(e) => setPaidRef(e.target.value.trim())}
            placeholder="payout reference id (required)"
            disabled={busy}
            autoCapitalize="off"
            spellCheck={false}
          />
          <Button
            size="sm"
            disabled={busy || !paidRef.trim()}
            onClick={() => call("mark_paid")}
          >
            Mark paid
          </Button>
        </>
      )}
    </div>
  );
}

function prettyError(code?: string): string {
  switch (code) {
    case "invalid_state":
      return "Already decided — refresh the page.";
    case "missing_paid_reference":
      return "Paste the payout reference id first.";
    case "not_found":
      return "That withdrawal vanished.";
    default:
      return "Action failed.";
  }
}
