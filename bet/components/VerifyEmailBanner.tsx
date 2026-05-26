"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import { MailWarning } from "lucide-react";
import { useTranslation } from "@/lib/i18n/client";

export function VerifyEmailBanner({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const { t: tr } = useTranslation();

  async function request() {
    setBusy(true);
    const res = await fetch("/api/auth/verify/request", { method: "POST" });
    setBusy(false);
    if (res.ok) {
      setSent(true);
      toast(tr("verifyBanner.sent"), "ok");
    } else {
      const body = await res.json().catch(() => ({}));
      toast(
        body.error === "rate_limited"
          ? tr("verifyBanner.rateLimited")
          : tr("verifyBanner.couldntSend"),
        "err",
      );
    }
  }

  if (sent) {
    // Split the message around {email} so we can bold the address.
    const banner = tr("verifyBanner.sentBanner", { email: "{{EMAIL}}" });
    const [before, after] = banner.split("{{EMAIL}}");
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
        {before}
        <strong>{email}</strong>
        {after}
      </div>
    );
  }

  // Split the message around {email} so we can bold the address.
  const message = tr("verifyBanner.message", { email: "{{EMAIL}}" });
  const [before, after] = message.split("{{EMAIL}}");

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
      <div className="flex items-start gap-2 text-sm">
        <MailWarning className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-300" />
        <span className="text-amber-200">
          {before}
          <strong>{email}</strong>
          {after}
        </span>
      </div>
      <Button size="sm" variant="secondary" disabled={busy} onClick={request}>
        {busy ? tr("verifyBanner.sending") : tr("verifyBanner.sendLink")}
      </Button>
    </div>
  );
}
