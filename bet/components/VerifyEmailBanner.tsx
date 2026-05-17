"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import { MailWarning } from "lucide-react";

export function VerifyEmailBanner({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function request() {
    setBusy(true);
    const res = await fetch("/api/auth/verify/request", { method: "POST" });
    setBusy(false);
    if (res.ok) {
      setSent(true);
      toast("Verification email sent. Check your inbox (or dev console).", "ok");
    } else {
      const body = await res.json().catch(() => ({}));
      toast(body.error === "rate_limited" ? "Wait a bit before requesting again." : "Couldn't send email.", "err");
    }
  }

  if (sent) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
        Sent. Click the link in the email (or your dev terminal) to finish
        verifying <strong>{email}</strong>.
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
      <div className="flex items-start gap-2 text-sm">
        <MailWarning className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-300" />
        <span className="text-amber-200">
          Verify <strong>{email}</strong> to confirm your account.
        </span>
      </div>
      <Button size="sm" variant="secondary" disabled={busy} onClick={request}>
        {busy ? "Sending…" : "Send link"}
      </Button>
    </div>
  );
}
