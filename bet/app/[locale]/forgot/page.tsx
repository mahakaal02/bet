"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import {
  DEFAULT_LOCALE,
  isLocale,
  localizedPath,
  t,
  type Locale,
} from "@/lib/i18n";

export default function ForgotPage() {
  const routeParams = useParams<{ locale: string }>();
  const locale: Locale = isLocale(routeParams.locale)
    ? routeParams.locale
    : DEFAULT_LOCALE;
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);
  const lp = (h: string) => localizedPath(h, locale);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/auth/password-reset/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setBusy(false);
    if (res.ok) {
      setSent(true);
    } else {
      const body = await res.json().catch(() => ({}));
      toast(
        body.error === "rate_limited"
          ? tr("auth.tooManyRequests")
          : tr("auth.couldntSendLink"),
        "err",
      );
    }
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-md px-4 py-12">
        <Link href={lp("/login")} className="mb-6 inline-block text-sm text-slate-400 hover:text-slate-200">
          {tr("auth.backToSignIn")}
        </Link>
        <Badge tone="info" className="mb-3">{tr("meta.siteName")}</Badge>
        <h1 className="text-2xl font-black">{tr("auth.forgotPasswordHeading")}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {tr("auth.forgotPasswordSubtext")}
        </p>

        <Card className="mt-4">
          {sent ? (
            <p className="text-sm text-emerald-300">
              {tr("auth.forgotSuccess", { email })}
              <span className="mt-2 block text-xs text-slate-500">
                {tr("auth.forgotDevNote")}
              </span>
            </p>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-3">
              <Input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={tr("auth.forgotEmailPlaceholder")}
              />
              <Button type="submit" disabled={busy}>
                {busy ? tr("auth.forgotSendingButton") : tr("auth.forgotSendButton")}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </main>
  );
}
