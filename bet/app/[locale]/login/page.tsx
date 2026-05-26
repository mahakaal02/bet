"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
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

const googleEnabled =
  typeof process !== "undefined" &&
  (process.env.NEXT_PUBLIC_GOOGLE_ENABLED ?? "") === "true";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const routeParams = useParams<{ locale: string }>();
  const locale: Locale = isLocale(routeParams.locale)
    ? routeParams.locale
    : DEFAULT_LOCALE;
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);
  const lp = (h: string) => localizedPath(h, locale);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setBusy(false);
    if (res?.ok) {
      const to = params.get("next") ?? lp("/markets");
      router.replace(to);
    } else {
      toast(tr("auth.invalidCredentials"), "err");
    }
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex max-w-md flex-col px-4 py-12">
        <Link href={lp("/")} className="mb-6 self-start text-sm text-slate-400 hover:text-slate-200">
          {tr("auth.backButton")}
        </Link>
        <Badge tone="info" className="mb-3 self-start">{tr("meta.siteName")}</Badge>
        <h1 className="text-3xl font-black">{tr("auth.welcomeHeading")}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {tr("auth.welcomeSubtext")}
        </p>

        <Card className="mt-6">
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                {tr("auth.emailLabel")}
              </label>
              <Input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                {tr("auth.passwordLabel")}
              </label>
              <Input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? tr("auth.signingInButton") : tr("auth.signInButton")}
            </Button>
            <Link
              href={lp("/forgot")}
              className="self-end text-xs text-slate-400 hover:text-slate-200"
            >
              {tr("auth.forgotPasswordLink")}
            </Link>
          </form>

          {googleEnabled && (
            <>
              <div className="my-4 flex items-center gap-3 text-xs text-slate-500">
                <span className="h-px flex-1 bg-slate-800" />
                or
                <span className="h-px flex-1 bg-slate-800" />
              </div>
              <Button
                variant="secondary"
                onClick={() => signIn("google", { callbackUrl: lp("/markets") })}
                className="w-full"
              >
                {tr("auth.googleSignIn")}
              </Button>
            </>
          )}
        </Card>

        {/* Sign-up lives on the auctions login surface — Bet has no
            standalone "create account" path now that user identity is
            owned by the auctions backend (see lib/auth.ts). */}
      </div>
    </main>
  );
}
