"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";

export function TicketThreadClient({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (body.trim().length < 1) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/me/support/${ticketId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? "Reply failed.");
      setBody("");
      // Re-fetch the thread.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reply failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-2">
      <textarea
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={5000}
        placeholder="Reply…"
        className="w-full rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
      />
      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}
      <button
        type="button"
        disabled={busy || body.trim().length < 1}
        onClick={send}
        className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
      >
        {busy ? "Sending…" : "Send"}
      </button>
    </Card>
  );
}
