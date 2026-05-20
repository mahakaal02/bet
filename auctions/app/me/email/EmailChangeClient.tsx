"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import type { PendingChange } from "./page";

/**
 * Two views, driven by whether there's an in-flight request:
 *
 *   1. **None** — form: new email + current password. Submitting
 *      doesn't change anything immediately; both confirmation
 *      emails (old + new address) need clicks.
 *
 *   2. **Pending** — progress card. Shows which side(s) have
 *      confirmed, when the request expires, and a cancel button.
 *      Polls every 15s while open so the second-confirm flips the
 *      card to "applied" automatically.
 */
export function EmailChangeClient({
  initial,
}: {
  initial: PendingChange | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingChange | null>(initial);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Poll while a request is pending so the UI flips to "applied"
  // (i.e. `pending = null`) as soon as the second-confirm lands.
  useEffect(() => {
    if (!pending) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/me/email-change", { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json();
        if (body?.pending === null) {
          setPending(null);
          setInfo("Email change applied. Future sign-in links will go to the new address.");
          router.refresh();
        } else if (body?.newEmail) {
          setPending(body as PendingChange);
        }
      } catch {
        /* ignore transient errors during poll */
      }
    }, 15_000);
    return () => clearInterval(interval);
  }, [pending, router]);

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/me/email-change/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newEmail: newEmail.trim(), password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.message ?? "Couldn't start email change.");
        return;
      }
      // Re-fetch the pending state so the UI swaps into progress
      // mode without a manual reload.
      const next = await fetch("/api/me/email-change", { cache: "no-store" });
      if (next.ok) {
        const pn = await next.json();
        if (pn?.newEmail) setPending(pn as PendingChange);
      }
      setPassword("");
      setNewEmail("");
      setInfo(
        "Two confirmation emails are on the way — one to your current address and one to the new one. Both links must be clicked.",
      );
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!confirm("Cancel the in-flight email change request?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/email-change/cancel", {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? "Couldn't cancel.");
        return;
      }
      setPending(null);
      setInfo("Request cancelled.");
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  if (pending) {
    const expires = new Date(pending.expiresAt);
    return (
      <Card>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-300">
          Change pending
        </h2>
        <p className="mt-1 text-sm text-slate-300">
          Pending change to <code className="font-mono">{pending.newEmail}</code>.
          Expires {expires.toLocaleString()}.
        </p>
        <ul className="mt-3 space-y-1.5 text-sm">
          <li>
            <ConfirmStatus
              label="Current email confirmation"
              done={pending.oldConfirmed}
            />
          </li>
          <li>
            <ConfirmStatus
              label="New email confirmation"
              done={pending.newConfirmed}
            />
          </li>
        </ul>
        {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
        {info && <p className="mt-3 text-xs text-emerald-300">{info}</p>}
        <div className="mt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={cancel}
            disabled={busy}
            className="border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
          >
            {busy ? "Cancelling…" : "Cancel request"}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
        Request a change
      </h2>
      <form onSubmit={submitRequest} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-400">
            new email
          </span>
          <Input
            type="email"
            autoComplete="email"
            required
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-400">
            current password
          </span>
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="text-xs text-rose-300">{error}</p>}
        {info && <p className="text-xs text-emerald-300">{info}</p>}
        <Button
          type="submit"
          disabled={busy || !newEmail || !password}
          className="w-full"
        >
          {busy ? "Sending links…" : "Send confirmation links"}
        </Button>
      </form>
    </Card>
  );
}

function ConfirmStatus({
  label,
  done,
}: {
  label: string;
  done: boolean;
}) {
  return (
    <span
      className={`flex items-center justify-between rounded border px-3 py-2 ${
        done
          ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-100"
          : "border-slate-700 bg-slate-900/60 text-slate-300"
      }`}
    >
      <span>{label}</span>
      <span aria-hidden>{done ? "✓" : "…"}</span>
    </span>
  );
}
