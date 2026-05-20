"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

/**
 * The form is a single-shot: submit once and the page swaps to a
 * generic acknowledgement. No retry affordance on the same page —
 * if the email never arrives the user opens the form again
 * separately. That's intentional, because allowing in-place retry
 * makes the per-IP rate-limiter much louder than it needs to be.
 */
export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.status === 429) {
        const body = await res.json().catch(() => ({}));
        setError(
          body?.message ?? "Too many attempts — please wait a few minutes.",
        );
        return;
      }
      // Both 200 and silently-failed-backend land here: the page
      // always renders the same generic "we sent it if it exists"
      // message. Server-side enumeration resistance.
      setSubmitted(true);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-5 text-sm text-cyan-100">
        <p>
          If this email is registered with Kalki, a reset link is on
          its way. Check your inbox (and the spam folder) for an
          email from Kalki — the link is valid for 30 minutes.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-400">
          email
        </span>
        <Input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      {error && <p className="text-xs text-rose-300">{error}</p>}
      <Button type="submit" disabled={busy || !email} className="w-full">
        {busy ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
