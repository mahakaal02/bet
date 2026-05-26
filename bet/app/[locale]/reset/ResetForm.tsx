"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import {
  localizedPath,
  useTranslation,
} from "@/lib/i18n/client";

export function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { t: tr, locale } = useTranslation();
  const lp = (h: string) => localizedPath(h, locale);
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast(tr("validation.passwordMinLength"), "err");
      return;
    }
    if (password !== confirm) {
      toast(tr("validation.passwordsDontMatch"), "err");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/auth/password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    if (!res.ok) {
      setBusy(false);
      const body = await res.json().catch(() => ({}));
      toast(
        body.error === "invalid_or_expired"
          ? tr("auth.invalidOrExpiredLink")
          : tr("auth.couldntResetPassword"),
        "err",
      );
      return;
    }

    // Reset succeeded. The route echoes back the user's email so we can
    // drop straight into a credentials sign-in with the new password —
    // user lands on /markets fully authenticated without a second prompt.
    const body = await res.json().catch(() => ({}));
    if (body.email && typeof body.email === "string") {
      const signedIn = await signIn("credentials", {
        email: body.email,
        password,
        redirect: false,
      });
      setBusy(false);
      if (signedIn?.ok) {
        toast(tr("auth.passwordUpdatedSignedIn"), "ok");
        router.replace(lp("/markets"));
        return;
      }
      // Sign-in shouldn't fail (we just set the password), but if NextAuth
      // refuses for any reason — banned user, server error — fall through
      // to /login so the user can retry manually.
    }
    setBusy(false);
    toast(tr("auth.passwordUpdatedSignIn"), "ok");
    router.replace(lp("/login"));
  }

  if (!token) {
    return (
      <main className="min-h-screen">
        <div className="mx-auto max-w-md px-4 py-12">
          <Card>
            <p className="text-sm text-rose-300">{tr("auth.missingResetToken")}</p>
            <Link
              href={lp("/forgot")}
              className="mt-3 inline-block text-sm text-cyan-300"
            >
              {tr("auth.requestNewLink")}
            </Link>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-md px-4 py-12">
        <Badge tone="info" className="mb-3">{tr("meta.siteName")}</Badge>
        <h1 className="text-2xl font-black">{tr("auth.chooseNewPasswordHeading")}</h1>

        <Card className="mt-4">
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                {tr("auth.newPasswordLabel")}
              </label>
              <Input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                {tr("auth.confirmPasswordLabel")}
              </label>
              <Input
                type="password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? tr("auth.updatingPasswordButton") : tr("auth.updatePasswordButton")}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
