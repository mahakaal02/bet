"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { toast } from "@/components/ui/Toaster";
import {
  DEFAULT_LOCALE,
  isLocale,
  localizedPath,
  t,
  type Locale,
} from "@/lib/i18n";

export default function RegisterPage() {
  const router = useRouter();
  const routeParams = useParams<{ locale: string }>();
  const locale: Locale = isLocale(routeParams.locale)
    ? routeParams.locale
    : DEFAULT_LOCALE;
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);
  const lp = (h: string) => localizedPath(h, locale);
  const [form, setForm] = useState({
    email: "",
    username: "",
    password: "",
    referralCode: "",
  });
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast(prettyError(body.error, locale), "err");
        setBusy(false);
        return;
      }
      const signedIn = await signIn("credentials", {
        email: form.email,
        password: form.password,
        redirect: false,
      });
      if (signedIn?.ok) {
        toast(tr("auth.signUpSuccess"), "ok");
        router.replace(lp("/markets"));
      } else {
        router.replace(lp("/login"));
      }
    } catch {
      toast(tr("toast.error"), "err");
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex max-w-md flex-col px-4 py-12">
        <Link href={lp("/")} className="mb-6 self-start text-sm text-slate-400 hover:text-slate-200">
          {tr("auth.backButton")}
        </Link>
        <Badge tone="info" className="mb-3 self-start">{tr("meta.siteName")}</Badge>
        <h1 className="text-3xl font-black">{tr("auth.createAccountHeading")}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {tr("auth.createSubtext")}
        </p>

        <Card className="mt-6">
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <Field label={tr("auth.emailLabel")}>
              <Input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label={tr("auth.usernameLabel")}>
              <Input
                required
                minLength={3}
                maxLength={20}
                pattern="[a-zA-Z0-9_]+"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder={tr("auth.usernamePlaceholder")}
              />
            </Field>
            <Field label={tr("auth.passwordLabel")}>
              <Input
                type="password"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>
            <Field label={tr("auth.referralCodeLabel")}>
              <Input
                value={form.referralCode}
                onChange={(e) =>
                  setForm({ ...form, referralCode: e.target.value.toUpperCase() })
                }
                placeholder={tr("auth.referralCodePlaceholder")}
              />
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? tr("auth.creatingAccountButton") : tr("auth.createAccountButton")}
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-center text-sm text-slate-400">
          {tr("auth.alreadyRegistered")}{" "}
          <Link href={lp("/login")} className="font-semibold text-cyan-300 hover:text-cyan-200">
            {tr("auth.signInLink")}
          </Link>
        </p>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </label>
      {children}
    </div>
  );
}

function prettyError(code: string | undefined, locale: Locale): string {
  switch (code) {
    case "email_taken":
      return t("auth.emailTaken", locale);
    case "username_taken":
      return t("auth.usernameTaken", locale);
    case "rate_limited":
      return t("auth.rateLimited", locale);
    case "invalid_input":
      return t("auth.invalidInput", locale);
    default:
      return t("auth.createError", locale);
  }
}
