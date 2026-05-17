"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { toast } from "@/components/ui/Toaster";

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
      const to = params.get("next") ?? "/markets";
      router.replace(to);
    } else {
      toast("Invalid email or password.", "err");
    }
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex max-w-md flex-col px-4 py-12">
        <Link href="/" className="mb-6 self-start text-sm text-slate-400 hover:text-slate-200">
          ← Back
        </Link>
        <Badge tone="info" className="mb-3 self-start">Kalki Exchange</Badge>
        <h1 className="text-3xl font-black">Welcome back</h1>
        <p className="mt-1 text-sm text-slate-400">
          Sign in to trade prediction markets with your Kalki Bet coins.
        </p>

        <Card className="mt-6">
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Email
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
                Password
              </label>
              <Input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
            <Link
              href="/forgot"
              className="self-end text-xs text-slate-400 hover:text-slate-200"
            >
              Forgot password?
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
                onClick={() => signIn("google", { callbackUrl: "/markets" })}
                className="w-full"
              >
                Continue with Google
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
