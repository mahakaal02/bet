"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";

const CATEGORIES = [
  { value: "ACCOUNT", label: "Account" },
  { value: "WITHDRAWAL", label: "Withdrawal" },
  { value: "DEPOSIT", label: "Deposit" },
  { value: "BIDDING", label: "Bidding" },
  { value: "AVIATOR", label: "Aviator" },
  { value: "ORDER_FULFILLMENT", label: "Order / shipping" },
  { value: "TECHNICAL", label: "Technical" },
  { value: "OTHER", label: "Other" },
] as const;

/**
 * Compact submit form. Anti-duplicate logic lives on the server —
 * if the user has an existing active ticket in the same category,
 * the POST returns 409 with `existingTicketId` and we redirect
 * there rather than confusing the user with a "you have an open
 * ticket" toast that requires a click to action.
 */
export function SubmitTicketForm() {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<typeof CATEGORIES[number]["value"]>("ACCOUNT");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (subject.trim().length < 4 || body.trim().length < 10) {
      setError("Subject ≥ 4 chars, body ≥ 10 chars.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: subject.trim(), body: body.trim(), category }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409 && json?.existingTicketId) {
        // Redirect to the existing ticket — friendlier than a toast.
        router.push(`/me/support/${json.existingTicketId}`);
        return;
      }
      if (!res.ok) {
        throw new Error(json?.message ?? json?.code ?? "Submit failed.");
      }
      router.push(`/me/support/${json.ticketId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
        New ticket
      </h2>
      <label className="block">
        <span className="mb-1 block text-xs text-slate-500">Category</span>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as typeof category)}
          className="w-full rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-slate-500">Subject</span>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          placeholder="Short summary"
          className="w-full rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-slate-500">What's happening?</span>
        <textarea
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={5000}
          placeholder="Describe the issue with as much detail as possible."
          className="w-full rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
        />
      </label>
      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
      >
        {busy ? "Submitting…" : "Open ticket"}
      </button>
    </Card>
  );
}
