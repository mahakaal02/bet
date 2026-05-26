"use client";

import { useEffect, useState } from "react";

/**
 * Runs the confirm POST on mount. The token reaches the user via
 * email link, so the user expects the page to do something on
 * arrival — no extra "confirm" button is shown.
 *
 * Three outcomes:
 *   - `applied=true`  → both sides confirmed, email changed.
 *   - `applied=false` → this side is confirmed, the other side
 *                       still needs to click its link.
 *   - error           → bad / expired / already-cancelled token.
 */
type Outcome =
  | { kind: "loading" }
  | { kind: "single-side"; side: "old" | "new" }
  | { kind: "applied"; side: "old" | "new" }
  | { kind: "error"; message: string };

export function ConfirmClient({ token }: { token: string }) {
  const [outcome, setOutcome] = useState<Outcome>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/email-change/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setOutcome({
            kind: "error",
            message:
              body?.message ?? "This link is invalid or has expired.",
          });
          return;
        }
        if (body?.applied) {
          setOutcome({ kind: "applied", side: body.side });
        } else if (body?.side) {
          setOutcome({ kind: "single-side", side: body.side });
        } else {
          setOutcome({
            kind: "error",
            message: "Unexpected response from server.",
          });
        }
      } catch {
        if (!cancelled) {
          setOutcome({
            kind: "error",
            message:
              "Couldn't reach the auctions service — try the link again in a minute.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (outcome.kind === "loading") {
    return (
      <p className="mt-4 text-sm text-slate-400">Confirming…</p>
    );
  }
  if (outcome.kind === "error") {
    return (
      <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-5 text-sm text-rose-100">
        {outcome.message}
      </div>
    );
  }
  if (outcome.kind === "single-side") {
    return (
      <div className="mt-4 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-5 text-sm text-cyan-100">
        <p className="font-semibold">
          Your {outcome.side === "old" ? "current" : "new"} email is
          confirmed.
        </p>
        <p className="mt-2">
          Now open the link in your{" "}
          {outcome.side === "old" ? "new" : "current"} email to finish
          the change. Both sides have to confirm before it takes
          effect.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-5 text-sm text-emerald-100">
      <p className="font-semibold">Email change complete.</p>
      <p className="mt-2">
        Your account is now using the new email. Sign-in continues to
        work the same way — just with the new address.
      </p>
    </div>
  );
}
