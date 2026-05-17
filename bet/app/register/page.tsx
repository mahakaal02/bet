"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { toast } from "@/components/ui/Toaster";

export default function RegisterPage() {
  const router = useRouter();
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
        toast(prettyError(body.error), "err");
        setBusy(false);
        return;
      }
      const signedIn = await signIn("credentials", {
        email: form.email,
        password: form.password,
        redirect: false,
      });
      if (signedIn?.ok) {
        toast("Welcome! 10,000 starter coins are in your wallet.", "ok");
        router.replace("/markets");
      } else {
        router.replace("/login");
      }
    } catch {
      toast("Something went wrong.", "err");
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex max-w-md flex-col px-4 py-12">
        <Link href="/" className="mb-6 self-start text-sm text-slate-400 hover:text-slate-200">
          ← Back
        </Link>
        <Badge tone="info" className="mb-3 self-start">Kalki Exchange</Badge>
        <h1 className="text-3xl font-black">Create your account</h1>
        <p className="mt-1 text-sm text-slate-400">
          We&apos;ll credit you{" "}
          <span className="font-semibold text-cyan-300">10,000 starter coins</span>{" "}
          instantly — they work across markets, auctions and Aviator.
        </p>

        <Card className="mt-6">
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <Field label="Email">
              <Input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Username">
              <Input
                required
                minLength={3}
                maxLength={20}
                pattern="[a-zA-Z0-9_]+"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="3–20 chars, letters/digits/underscore"
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>
            <Field label="Referral code (optional)">
              <Input
                value={form.referralCode}
                onChange={(e) =>
                  setForm({ ...form, referralCode: e.target.value.toUpperCase() })
                }
                placeholder="ABC123"
              />
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating account…" : "Create account"}
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-center text-sm text-slate-400">
          Already registered?{" "}
          <Link href="/login" className="font-semibold text-cyan-300 hover:text-cyan-200">
            Sign in
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

function prettyError(code?: string): string {
  switch (code) {
    case "email_taken":
      return "That email is already registered.";
    case "username_taken":
      return "That username is taken.";
    case "rate_limited":
      return "Too many attempts — please wait a minute.";
    case "invalid_input":
      return "Please check the form for errors.";
    default:
      return "Could not create account.";
  }
}
