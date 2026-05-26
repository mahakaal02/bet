"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import type { DeletionStatus } from "./page";

/**
 * Three panels:
 *
 *   1. Pending banner — visible when a deletion is in-flight.
 *      Surfaces the countdown + cancel button.
 *   2. Data export — JSON download (always available, including
 *      mid-cool-off).
 *   3. Delete request — only visible when no deletion is pending.
 *      Two-step confirmation: user must type their username to
 *      arm the destructive button.
 *
 * Cancel + request both refresh the server-rendered status by
 * calling router.refresh().
 */
export function DeletionClient({ initial }: { initial: DeletionStatus }) {
  const router = useRouter();
  const [status, setStatus] = useState<DeletionStatus>(initial);
  const [reason, setReason] = useState("");
  const [typedUsername, setTypedUsername] = useState("");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  async function startDeletion() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/account-deletion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.message ?? "Couldn't schedule deletion.");
        return;
      }
      // Re-fetch status to flip the page into pending mode.
      const next = await fetch("/api/me/account-deletion", {
        cache: "no-store",
      });
      if (next.ok) setStatus((await next.json()) as DeletionStatus);
      setReason("");
      setTypedUsername("");
      setArmed(false);
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelDeletion() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/account-deletion/cancel", {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.message ?? "Couldn't cancel deletion.");
        return;
      }
      setStatus({ pending: false });
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadExport() {
    setExporting(true);
    setError(null);
    try {
      const res = await fetch("/api/me/data-export", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? "Couldn't generate export.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Server already set a sensible Content-Disposition filename;
      // we override the download attribute in case the browser
      // ignores the header (rare but possible).
      const cd = res.headers.get("content-disposition") ?? "";
      const match = cd.match(/filename="?([^"]+)"?/);
      a.download = match ? match[1] : "kalki-data-export.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Network error.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      {status.pending && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-200">
            Account deletion scheduled
          </h2>
          <p className="mt-2 text-sm text-slate-200">
            Effective in <strong>{status.daysRemaining}</strong> days —{" "}
            {new Date(status.effectiveAt).toLocaleString()}.
          </p>
          {status.reason && (
            <p className="mt-1 text-xs text-slate-400">
              Reason: {status.reason}
            </p>
          )}
          <Button
            type="button"
            onClick={cancelDeletion}
            disabled={busy}
            className="mt-4 w-full"
          >
            {busy ? "Cancelling…" : "Cancel deletion"}
          </Button>
        </Card>
      )}

      <Card>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Data export
        </h2>
        <p className="mb-3 text-sm text-slate-300">
          Download a JSON file with every record we hold on you —
          bids, notifications, addresses, profile history, daily-login
          claims, responsible-gambling events. Doesn&apos;t close the
          account; you can run this any time.
        </p>
        {error && <p className="mb-2 text-xs text-rose-300">{error}</p>}
        <Button
          type="button"
          variant="secondary"
          onClick={downloadExport}
          disabled={exporting}
        >
          {exporting ? "Preparing download…" : "Download my data"}
        </Button>
      </Card>

      {!status.pending && (
        <Card className="border-rose-500/40 bg-rose-500/5 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-rose-200">
            Close my account
          </h2>
          <p className="text-sm text-slate-200">
            Schedules deletion in <strong>30 days</strong>. During the
            cool-off you can sign in as normal and cancel any time.
            After the window ends:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
            <li>
              Personal info (email, display name, avatar, phone)
              wiped. Username becomes <code>deleted-&lt;id&gt;</code>.
            </li>
            <li>
              2FA + trusted devices + password resets cleared.
              Sign-in stops working.
            </li>
            <li>
              Bid history and audit / regulatory records are kept
              (anonymised) for financial reconciliation.
            </li>
          </ul>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">
              reason (optional)
            </span>
            <Input
              type="text"
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Helps us improve — but you can skip this"
            />
          </label>

          {!armed ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setArmed(true)}
              className="border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
            >
              Continue to delete
            </Button>
          ) : (
            <div className="space-y-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3">
              <p className="text-sm text-rose-100">
                To confirm, type your username below. This starts the
                30-day deletion cool-off.
              </p>
              <Input
                type="text"
                value={typedUsername}
                onChange={(e) => setTypedUsername(e.target.value)}
                placeholder="your @username"
              />
              {error && <p className="text-xs text-rose-300">{error}</p>}
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={startDeletion}
                  disabled={busy || !typedUsername.trim()}
                  className="bg-rose-500 hover:bg-rose-500/90"
                >
                  {busy ? "Scheduling…" : "Schedule deletion"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setArmed(false);
                    setTypedUsername("");
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
